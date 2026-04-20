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

// ── Built-in palettes (6 variants per category) ──────────────────────────────
// Each category has six palette variants so the default 6-candidate
// gallery (Step 21) lands on a distinct palette per candidate — no
// repeats. Variants span saturation, temperature, and lightness while
// staying on the category's mood:
//   slot 0  canonical  (the category's signature palette)
//   slot 1  lighter / airier
//   slot 2  deeper / grounded
//   slot 3  cooler shift
//   slot 4  warmer shift
//   slot 5  adjacent-hue cousin
//
// Array length is unbounded — getScenePalette uses modulo, so we can
// extend to 8 / 10 / N palettes per category without API changes if a
// bigger gallery flow lands.

export const SCENE_PALETTES: Record<string, ScenePalette[]> = {
  productivity: [
    { sky: ["#EFF6FF", "#DBEAFE"], ground: ["#BFDBFE", "#93C5FD"], subject: "#1D4ED8", accent: "#F97316", ink: "#0F172A" },
    { sky: ["#F0F9FF", "#E0F2FE"], ground: ["#BAE6FD", "#7DD3FC"], subject: "#0369A1", accent: "#FBBF24", ink: "#0C4A6E" },
    { sky: ["#EEF2FF", "#E0E7FF"], ground: ["#C7D2FE", "#A5B4FC"], subject: "#4338CA", accent: "#F97316", ink: "#1E1B4B" },
    { sky: ["#F0FDFA", "#CCFBF1"], ground: ["#99F6E4", "#5EEAD4"], subject: "#0F766E", accent: "#F59E0B", ink: "#134E4A" },
    { sky: ["#FAFAFA", "#F5F5F5"], ground: ["#E5E5E5", "#D4D4D4"], subject: "#262626", accent: "#2563EB", ink: "#171717" },
    { sky: ["#F5F3FF", "#EDE9FE"], ground: ["#DDD6FE", "#C4B5FD"], subject: "#6D28D9", accent: "#F97316", ink: "#2E1065" },
  ],
  wellness: [
    { sky: ["#ECFDF5", "#D1FAE5"], ground: ["#A7F3D0", "#6EE7B7"], subject: "#059669", accent: "#F59E0B", ink: "#064E3B" },
    { sky: ["#F0FDF4", "#DCFCE7"], ground: ["#BBF7D0", "#86EFAC"], subject: "#15803D", accent: "#EAB308", ink: "#14532D" },
    { sky: ["#F7FEE7", "#ECFCCB"], ground: ["#D9F99D", "#BEF264"], subject: "#4D7C0F", accent: "#F59E0B", ink: "#365314" },
    { sky: ["#F0FDFA", "#CCFBF1"], ground: ["#99F6E4", "#5EEAD4"], subject: "#115E59", accent: "#F59E0B", ink: "#134E4A" },
    { sky: ["#FEFCE8", "#FEF9C3"], ground: ["#FEF08A", "#FDE047"], subject: "#65A30D", accent: "#F97316", ink: "#3F6212" },
    { sky: ["#EFF6FF", "#DBEAFE"], ground: ["#BFDBFE", "#93C5FD"], subject: "#047857", accent: "#F59E0B", ink: "#064E3B" },
  ],
  education: [
    { sky: ["#FEF3C7", "#FDE68A"], ground: ["#FBBF24", "#F59E0B"], subject: "#7C2D12", accent: "#2563EB", ink: "#451A03" },
    { sky: ["#FFFBEB", "#FEF3C7"], ground: ["#FDE68A", "#FCD34D"], subject: "#B45309", accent: "#1D4ED8", ink: "#78350F" },
    { sky: ["#FFF7ED", "#FFEDD5"], ground: ["#FED7AA", "#FDBA74"], subject: "#9A3412", accent: "#0369A1", ink: "#7C2D12" },
    { sky: ["#FFFBEB", "#FEF3C7"], ground: ["#FCD34D", "#FBBF24"], subject: "#854D0E", accent: "#15803D", ink: "#713F12" },
    { sky: ["#FEF2F2", "#FEE2E2"], ground: ["#FECACA", "#FCA5A5"], subject: "#9A3412", accent: "#1D4ED8", ink: "#7F1D1D" },
    { sky: ["#EFF6FF", "#DBEAFE"], ground: ["#BFDBFE", "#93C5FD"], subject: "#1E3A8A", accent: "#F59E0B", ink: "#172554" },
  ],
  business: [
    { sky: ["#F1F5F9", "#CBD5E1"], ground: ["#94A3B8", "#64748B"], subject: "#1E3A8A", accent: "#F59E0B", ink: "#0F172A" },
    { sky: ["#F8FAFC", "#E2E8F0"], ground: ["#CBD5E1", "#94A3B8"], subject: "#1E293B", accent: "#DC2626", ink: "#020617" },
    { sky: ["#FAFAF9", "#E7E5E4"], ground: ["#D6D3D1", "#A8A29E"], subject: "#44403C", accent: "#EAB308", ink: "#1C1917" },
    { sky: ["#EFF6FF", "#DBEAFE"], ground: ["#BFDBFE", "#93C5FD"], subject: "#1E40AF", accent: "#F97316", ink: "#172554" },
    { sky: ["#F0F9FF", "#E0F2FE"], ground: ["#BAE6FD", "#7DD3FC"], subject: "#075985", accent: "#EA580C", ink: "#082F49" },
    { sky: ["#F8FAFC", "#F1F5F9"], ground: ["#E2E8F0", "#CBD5E1"], subject: "#0F172A", accent: "#10B981", ink: "#020617" },
  ],
  fitness: [
    { sky: ["#FEE2E2", "#FECACA"], ground: ["#FCA5A5", "#F87171"], subject: "#DC2626", accent: "#FBBF24", ink: "#7F1D1D" },
    { sky: ["#FFF1F2", "#FFE4E6"], ground: ["#FECDD3", "#FDA4AF"], subject: "#E11D48", accent: "#F97316", ink: "#881337" },
    { sky: ["#FEF2F2", "#FEE2E2"], ground: ["#FCA5A5", "#F87171"], subject: "#B91C1C", accent: "#16A34A", ink: "#7F1D1D" },
    { sky: ["#FFF7ED", "#FFEDD5"], ground: ["#FED7AA", "#FDBA74"], subject: "#C2410C", accent: "#0369A1", ink: "#7C2D12" },
    { sky: ["#FAFAFA", "#F5F5F5"], ground: ["#E5E5E5", "#D4D4D4"], subject: "#171717", accent: "#EF4444", ink: "#0A0A0A" },
    { sky: ["#FEFCE8", "#FEF9C3"], ground: ["#FEF08A", "#FDE047"], subject: "#CA8A04", accent: "#DC2626", ink: "#713F12" },
  ],
  beauty: [
    { sky: ["#FCE7F3", "#FBCFE8"], ground: ["#F9A8D4", "#F472B6"], subject: "#DB2777", accent: "#FBBF24", ink: "#831843" },
    { sky: ["#FDF2F8", "#FCE7F3"], ground: ["#FBCFE8", "#F9A8D4"], subject: "#BE185D", accent: "#F59E0B", ink: "#500724" },
    { sky: ["#FAE8FF", "#F5D0FE"], ground: ["#F0ABFC", "#E879F9"], subject: "#A21CAF", accent: "#F59E0B", ink: "#4A044E" },
    { sky: ["#FFF7ED", "#FFEDD5"], ground: ["#FED7AA", "#FDBA74"], subject: "#BE185D", accent: "#9A3412", ink: "#500724" },
    { sky: ["#F5F3FF", "#EDE9FE"], ground: ["#DDD6FE", "#C4B5FD"], subject: "#7E22CE", accent: "#F472B6", ink: "#3B0764" },
    { sky: ["#FDF2F8", "#FCE7F3"], ground: ["#F9A8D4", "#EC4899"], subject: "#831843", accent: "#FBBF24", ink: "#500724" },
  ],
  travel: [
    { sky: ["#DBEAFE", "#93C5FD"], ground: ["#60A5FA", "#3B82F6"], subject: "#1E40AF", accent: "#F97316", ink: "#172554" },
    { sky: ["#CFFAFE", "#A5F3FC"], ground: ["#67E8F9", "#22D3EE"], subject: "#0891B2", accent: "#F59E0B", ink: "#164E63" },
    { sky: ["#E0F2FE", "#BAE6FD"], ground: ["#7DD3FC", "#38BDF8"], subject: "#0284C7", accent: "#FB923C", ink: "#082F49" },
    { sky: ["#F0FDFA", "#CCFBF1"], ground: ["#99F6E4", "#5EEAD4"], subject: "#0F766E", accent: "#F97316", ink: "#134E4A" },
    { sky: ["#FEF3C7", "#FDE68A"], ground: ["#FBBF24", "#F59E0B"], subject: "#1E40AF", accent: "#DC2626", ink: "#451A03" },
    { sky: ["#ECFEFF", "#CFFAFE"], ground: ["#A5F3FC", "#67E8F9"], subject: "#155E75", accent: "#F97316", ink: "#164E63" },
  ],
  marketing: [
    { sky: ["#FFF7ED", "#FED7AA"], ground: ["#FDBA74", "#FB923C"], subject: "#EA580C", accent: "#2563EB", ink: "#7C2D12" },
    { sky: ["#FEF2F2", "#FECACA"], ground: ["#FCA5A5", "#F87171"], subject: "#DC2626", accent: "#0369A1", ink: "#7F1D1D" },
    { sky: ["#FDF4FF", "#F5D0FE"], ground: ["#F0ABFC", "#E879F9"], subject: "#C026D3", accent: "#EAB308", ink: "#701A75" },
    { sky: ["#FEFCE8", "#FEF9C3"], ground: ["#FEF08A", "#FDE047"], subject: "#CA8A04", accent: "#DB2777", ink: "#713F12" },
    { sky: ["#ECFDF5", "#D1FAE5"], ground: ["#A7F3D0", "#6EE7B7"], subject: "#047857", accent: "#DC2626", ink: "#064E3B" },
    { sky: ["#F0F9FF", "#E0F2FE"], ground: ["#BAE6FD", "#7DD3FC"], subject: "#0369A1", accent: "#F97316", ink: "#0C4A6E" },
  ],
  motivation: [
    { sky: ["#FDE68A", "#FBBF24"], ground: ["#F59E0B", "#D97706"], subject: "#1E3A8A", accent: "#EF4444", ink: "#78350F" },
    { sky: ["#FED7AA", "#FDBA74"], ground: ["#FB923C", "#F97316"], subject: "#7C2D12", accent: "#2563EB", ink: "#451A03" },
    { sky: ["#FEE2E2", "#FECACA"], ground: ["#F87171", "#EF4444"], subject: "#7F1D1D", accent: "#FBBF24", ink: "#450A0A" },
    { sky: ["#DBEAFE", "#93C5FD"], ground: ["#60A5FA", "#3B82F6"], subject: "#1E3A8A", accent: "#F59E0B", ink: "#172554" },
    { sky: ["#F5F3FF", "#EDE9FE"], ground: ["#C4B5FD", "#A78BFA"], subject: "#5B21B6", accent: "#FBBF24", ink: "#2E1065" },
    { sky: ["#FFFBEB", "#FEF3C7"], ground: ["#FDE68A", "#FCD34D"], subject: "#B45309", accent: "#DC2626", ink: "#78350F" },
  ],
};

export function getScenePalette(category: string, variant: number = 0): ScenePalette {
  const group = SCENE_PALETTES[category] ?? SCENE_PALETTES.productivity;
  return group[Math.abs(variant) % group.length];
}

// ── Part builders ───────────────────────────────────────────────────────────
// Each part returns a string fragment (no wrapping <svg>) so scenes can
// stack them in paint order.

// Phase-1 quality lift: every scene now wraps its <defs> with a shared
// effects library — drop-shadow filter, soft glow, inner-highlight
// gradient, paper grain. These give each composition a depth + polish
// pass that a flat-color SVG can't reach.
function defsEffects(p: ScenePalette, id: string): string {
  return (
    `<filter id="ds-${id}" x="-25%" y="-25%" width="150%" height="150%">` +
      `<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="${p.ink}" flood-opacity="0.18"/>` +
    `</filter>` +
    `<filter id="dsLg-${id}" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="${p.ink}" flood-opacity="0.22"/>` +
    `</filter>` +
    `<filter id="glow-${id}" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feGaussianBlur stdDeviation="6"/>` +
    `</filter>` +
    `<radialGradient id="hl-${id}" cx="35%" cy="30%" r="65%">` +
      `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.55"/>` +
      `<stop offset="55%" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="sh-${id}" cx="65%" cy="75%" r="55%">` +
      `<stop offset="0%" stop-color="${p.ink}" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="${p.ink}" stop-opacity="0.30"/>` +
    `</radialGradient>` +
    `<radialGradient id="sun-${id}" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="#FFF8E1"/>` +
      `<stop offset="60%" stop-color="${p.accent}"/>` +
      `<stop offset="100%" stop-color="${p.accent}" stop-opacity="0.7"/>` +
    `</radialGradient>` +
    `<linearGradient id="subj-${id}" x1="0%" y1="0%" x2="0%" y2="100%">` +
      `<stop offset="0%" stop-color="${lightenHex(p.subject, 0.18)}"/>` +
      `<stop offset="60%" stop-color="${p.subject}"/>` +
      `<stop offset="100%" stop-color="${darkenHex(p.subject, 0.20)}"/>` +
    `</linearGradient>` +
    `<linearGradient id="accent-${id}" x1="0%" y1="0%" x2="0%" y2="100%">` +
      `<stop offset="0%" stop-color="${lightenHex(p.accent, 0.22)}"/>` +
      `<stop offset="100%" stop-color="${p.accent}"/>` +
    `</linearGradient>`
  );
}

// Hex math helpers — small, no dependencies. Used to lighten / darken
// fill stops for gradients without needing a color-space lib.
function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const v = h.length === 3
    ? h.split("").map(c => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

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
      defsEffects(p, id) +
    `</defs>`
  );
}

// Skies ────────────────────────────────────────────────────────────────────
function skyFlat(p: ScenePalette, id: string): string {
  return `<rect width="400" height="260" fill="url(%23sky-${id})"/>`;
}
function skyWithSun(p: ScenePalette, id: string): string {
  // Warm radial sun with a real glow halo instead of two flat circles.
  return skyFlat(p, id) +
    `<circle cx="320" cy="80" r="64" fill="url(%23sun-${id})" opacity="0.35" filter="url(%23glow-${id})"/>` +
    `<circle cx="320" cy="80" r="38" fill="url(%23sun-${id})"/>` +
    `<circle cx="314" cy="72" r="10" fill="#FFFFFF" opacity="0.55"/>`;
}
function skyWithClouds(p: ScenePalette, id: string): string {
  // Layered cloud with subtle underside shading so they read volumetric.
  const cloud = (cx: number, cy: number, s: number) =>
    `<g opacity="0.92">` +
      `<ellipse cx="${cx + 2}" cy="${cy + 2}" rx="${38 * s}" ry="${15 * s}" fill="${p.ink}" opacity="0.06"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${36 * s}" ry="${14 * s}" fill="#FFFFFF"/>` +
      `<ellipse cx="${cx - 20 * s}" cy="${cy + 4}" rx="${22 * s}" ry="${11 * s}" fill="#FFFFFF"/>` +
      `<ellipse cx="${cx + 18 * s}" cy="${cy + 3}" rx="${20 * s}" ry="${10 * s}" fill="#FFFFFF"/>` +
      `<ellipse cx="${cx - 10 * s}" cy="${cy + 8}" rx="${28 * s}" ry="${4 * s}" fill="#FFFFFF" opacity="0.55"/>` +
    `</g>`;
  return skyFlat(p, id) + cloud(90, 70, 1) + cloud(260, 50, 0.8) + cloud(180, 110, 0.5);
}

// Grounds ──────────────────────────────────────────────────────────────────
function groundFlat(id: string): string {
  return `<rect y="260" width="400" height="140" fill="url(%23ground-${id})"/>`;
}
function groundHills(p: ScenePalette, id: string): string {
  return groundFlat(id) +
    `<path d="M0 280 Q100 240 200 280 T400 280 L400 400 L0 400 Z" fill="${p.ground[1]}" opacity="0.7"/>` +
    `<path d="M0 320 Q120 300 240 320 T400 320 L400 400 L0 400 Z" fill="${p.ground[0]}"/>` +
    // Ground-to-sky haze strip — atmospheric depth
    `<rect y="255" width="400" height="20" fill="url(%23ground-${id})" opacity="0.35"/>`;
}

// Mountains ────────────────────────────────────────────────────────────────
function peaks(p: ScenePalette, id: string): string {
  // Layered peaks with proper light-side / shadow-side + snow caps +
  // atmospheric back-layer for real depth.
  return (
    // Back layer — atmospheric haze silhouette
    `<polygon points="0,260 80,180 160,230 240,170 320,220 400,180 400,260" fill="${p.subject}" opacity="0.28"/>` +
    // Right peak (back)
    `<polygon points="160,260 260,160 360,260" fill="${darkenHex(p.subject, 0.10)}"/>` +
    // Right peak shadow side
    `<polygon points="260,160 290,200 260,260" fill="${darkenHex(p.subject, 0.25)}" opacity="0.55"/>` +
    // Right peak snow
    `<polygon points="260,160 280,185 295,180 310,205 282,228 260,200" fill="#FFFFFF" opacity="0.92"/>` +
    `<polygon points="260,160 268,175 260,185" fill="#FFFFFF"/>` +
    // Left peak (front)
    `<polygon points="40,260 130,140 220,260" fill="url(%23subj-${id})"/>` +
    // Left peak shadow side
    `<polygon points="130,140 170,195 130,260 90,260" fill="${p.ink}" opacity="0.18"/>` +
    // Left peak snow
    `<polygon points="130,140 155,170 172,165 195,195 165,225 130,190" fill="#FFFFFF" opacity="0.95"/>` +
    `<polygon points="130,140 140,158 130,170" fill="#FFFFFF"/>`
  );
}

// Plant / leaf ─────────────────────────────────────────────────────────────
function pottedPlant(p: ScenePalette, id: string): string {
  const leaf = (cx: number, cy: number, rx: number, ry: number, rot: number, fill: string) =>
    `<g transform="rotate(${rot} ${cx} ${cy})">` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>` +
      `<path d="M${cx - rx + 2} ${cy} Q${cx} ${cy - ry * 0.4} ${cx + rx - 2} ${cy}" ` +
        `stroke="${darkenHex(fill, 0.25)}" stroke-width="1.4" fill="none" opacity="0.75"/>` +
      `<ellipse cx="${cx - rx * 0.35}" cy="${cy - ry * 0.3}" rx="${rx * 0.35}" ry="${ry * 0.5}" fill="#FFFFFF" opacity="0.2"/>` +
    `</g>`;
  return (
    // Pot shadow
    `<ellipse cx="200" cy="398" rx="86" ry="8" fill="${p.ink}" opacity="0.2"/>` +
    // Pot body + rim + highlight
    `<path d="M140 310 L260 310 L245 390 L155 390 Z" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="135" y="300" width="130" height="14" fill="${darkenHex(p.subject, 0.15)}"/>` +
    `<rect x="138" y="302" width="124" height="4" fill="#FFFFFF" opacity="0.22"/>` +
    `<rect x="148" y="316" width="6" height="65" fill="#FFFFFF" opacity="0.22"/>` +
    // Stems
    `<path d="M200 300 Q180 240 160 210" stroke="${darkenHex(p.accent, 0.25)}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M200 300 Q210 240 230 200" stroke="${darkenHex(p.accent, 0.25)}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M200 300 Q195 250 200 200" stroke="${darkenHex(p.accent, 0.25)}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    // Leaves (with volumetric highlights)
    leaf(160, 200, 14, 26, -35, p.accent) +
    leaf(150, 170, 12, 24,  -20, lightenHex(p.accent, 0.10)) +
    leaf(240, 210, 12, 24,   30, p.accent) +
    leaf(255, 185, 14, 26,   25, lightenHex(p.accent, 0.10)) +
    leaf(200, 160, 12, 24,    0, lightenHex(p.accent, 0.15)) +
    leaf(185, 140, 10, 20,  -10, p.accent)
  );
}

// Heart ────────────────────────────────────────────────────────────────────
function heartShape(p: ScenePalette, id: string): string {
  const d = "M200 350 Q90 280 90 200 A70 70 0 0 1 200 180 A70 70 0 0 1 310 200 Q310 280 200 350 Z";
  return (
    // Soft glow halo
    `<g filter="url(%23glow-${id})" opacity="0.35"><path d="${d}" fill="${p.subject}"/></g>` +
    // Main heart with gradient fill + drop shadow
    `<path d="${d}" fill="url(%23subj-${id})" filter="url(%23dsLg-${id})"/>` +
    // Top highlight (glossy sheen)
    `<path d="${d}" fill="url(%23hl-${id})" opacity="0.7"/>` +
    // Inner shadow at bottom
    `<path d="${d}" fill="url(%23sh-${id})" opacity="0.5"/>` +
    // Sparkle highlight
    `<path d="M150 210 Q170 180 200 190" stroke="#FFFFFF" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.8"/>` +
    `<circle cx="225" cy="225" r="4" fill="#FFFFFF" opacity="0.85"/>`
  );
}

// Dumbbell ─────────────────────────────────────────────────────────────────
function dumbbell(p: ScenePalette, id: string): string {
  return (
    // Ground shadow
    `<ellipse cx="200" cy="260" rx="150" ry="8" fill="${p.ink}" opacity="0.25"/>` +
    // Bar
    `<rect x="130" y="195" width="140" height="22" rx="6" fill="${darkenHex(p.ink, 0.0)}" filter="url(%23ds-${id})"/>` +
    `<rect x="132" y="197" width="136" height="4" fill="#FFFFFF" opacity="0.25"/>` +
    // Left plates (2 layered)
    `<rect x="98"  y="170" width="44" height="70" rx="10" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="82"  y="180" width="22" height="48" rx="7"  fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="100" y="172" width="4" height="66" fill="#FFFFFF" opacity="0.3"/>` +
    // Right plates
    `<rect x="258" y="170" width="44" height="70" rx="10" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="296" y="180" width="22" height="48" rx="7"  fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="260" y="172" width="4" height="66" fill="#FFFFFF" opacity="0.3"/>` +
    // Motion lines (energy)
    `<path d="M30 150 L55 160 M40 200 L65 205 M35 250 L60 248" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>` +
    `<path d="M340 160 L365 150 M335 205 L360 200 M340 248 L365 250" stroke="${p.accent}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`
  );
}

// Trophy ───────────────────────────────────────────────────────────────────
function trophy(p: ScenePalette, id: string): string {
  return (
    // Glow halo
    `<circle cx="200" cy="200" r="140" fill="${p.accent}" opacity="0.15" filter="url(%23glow-${id})"/>` +
    // Base shadow
    `<ellipse cx="200" cy="278" rx="70" ry="6" fill="${p.ink}" opacity="0.35"/>` +
    // Cup with gradient
    `<path d="M150 120 L250 120 L245 220 A50 50 0 0 1 155 220 Z" fill="url(%23accent-${id})" stroke="${darkenHex(p.accent, 0.3)}" stroke-width="2" filter="url(%23dsLg-${id})"/>` +
    // Cup inner shadow + highlight
    `<path d="M150 120 L250 120 L245 220 A50 50 0 0 1 155 220 Z" fill="url(%23hl-${id})" opacity="0.55"/>` +
    // Handles
    `<path d="M150 140 Q116 140 116 175 Q116 210 155 215" stroke="${darkenHex(p.accent, 0.2)}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<path d="M250 140 Q284 140 284 175 Q284 210 245 215" stroke="${darkenHex(p.accent, 0.2)}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    // Neck / stem
    `<rect x="175" y="225" width="50" height="30" fill="url(%23accent-${id})" stroke="${darkenHex(p.accent, 0.3)}" stroke-width="2"/>` +
    // Base
    `<rect x="150" y="255" width="100" height="20" rx="4" fill="url(%23subj-${id})" stroke="${darkenHex(p.subject, 0.2)}" stroke-width="2"/>` +
    `<rect x="152" y="257" width="96" height="4" fill="#FFFFFF" opacity="0.25"/>` +
    // Gold shine strip + number
    `<rect x="170" y="150" width="60" height="4" fill="#FFFFFF" opacity="0.5"/>` +
    `<text x="200" y="190" text-anchor="middle" font-family="Inter, sans-serif" font-size="48" font-weight="900" fill="${p.ink}">1</text>`
  );
}

// Books stack ──────────────────────────────────────────────────────────────
function booksStack(p: ScenePalette, id: string): string {
  const book = (y: number, w: number, fill: string, yOff: number = 0, skew: number = 0) => {
    const x = (400 - w) / 2 + skew;
    return (
      `<rect x="${x}" y="${y + yOff}" width="${w}" height="30" rx="3" fill="${fill}" filter="url(%23ds-${id})"/>` +
      // Pages (visible from side)
      `<rect x="${x + 2}" y="${y + yOff + 4}" width="${w - 4}" height="3" fill="#FFFFFF" opacity="0.7"/>` +
      `<rect x="${x + 2}" y="${y + yOff + 9}" width="${w - 4}" height="1" fill="#FFFFFF" opacity="0.35"/>` +
      // Spine
      `<rect x="${x}" y="${y + yOff}" width="6" height="30" fill="${darkenHex(fill, 0.25)}"/>` +
      // Title band
      `<rect x="${x + 15}" y="${y + yOff + 12}" width="${w * 0.4}" height="3" fill="#FFFFFF" opacity="0.55"/>` +
      `<rect x="${x + 15}" y="${y + yOff + 18}" width="${w * 0.25}" height="2" fill="#FFFFFF" opacity="0.4"/>`
    );
  };
  return (
    // Shadow pool
    `<ellipse cx="200" cy="320" rx="110" ry="6" fill="${p.ink}" opacity="0.25"/>` +
    // 4 stacked books
    book(280, 190, p.subject, 0,  -6) +
    book(252, 170, p.accent,  0,   4) +
    book(225, 180, lightenHex(p.subject, 0.25), 0, -2) +
    book(197, 160, darkenHex(p.accent, 0.15),   0,  6) +
    // Bookmark
    `<path d="M195 160 L195 200 L202 192 L209 200 L209 160 Z" fill="#DC2626"/>`
  );
}

// Water bottle ─────────────────────────────────────────────────────────────
function waterBottle(p: ScenePalette, id: string): string {
  return (
    `<ellipse cx="200" cy="336" rx="48" ry="6" fill="${p.ink}" opacity="0.28"/>` +
    // Cap
    `<rect x="175" y="110" width="50" height="24" rx="4" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="177" y="112" width="46" height="5" fill="#FFFFFF" opacity="0.3"/>` +
    // Bottle body
    `<path d="M170 134 L230 134 L235 180 Q235 260 225 310 Q225 330 200 330 Q175 330 175 310 Q165 260 165 180 Z" ` +
      `fill="url(%23subj-${id})" filter="url(%23dsLg-${id})"/>` +
    // Water highlight
    `<path d="M178 200 L186 200 L188 280 L180 280 Z" fill="#FFFFFF" opacity="0.45"/>` +
    // Label
    `<rect x="175" y="210" width="50" height="48" rx="3" fill="#FFFFFF" opacity="0.85"/>` +
    `<rect x="180" y="218" width="38" height="4" fill="${p.accent}"/>` +
    `<rect x="180" y="228" width="30" height="2" fill="${p.ink}" opacity="0.35"/>` +
    `<rect x="180" y="236" width="32" height="2" fill="${p.ink}" opacity="0.35"/>` +
    // Bottom shadow
    `<path d="M175 290 L225 290 L222 310 Q200 322 178 310 Z" fill="${p.ink}" opacity="0.15"/>`
  );
}

// Plane (paper) ────────────────────────────────────────────────────────────
function paperPlane(p: ScenePalette, id: string): string {
  return (
    // Trail
    `<path d="M50 260 Q150 250 230 180" stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="6 6" opacity="0.7"/>` +
    `<path d="M80 280 Q170 280 240 200" stroke="${p.accent}" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="4 5" opacity="0.5"/>` +
    // Main wing (light side)
    `<polygon points="70,220 330,120 220,330 200,250 120,240" fill="url(%23subj-${id})" filter="url(%23dsLg-${id})"/>` +
    // Shadow wing (folded under)
    `<polygon points="70,220 200,250 120,240" fill="${p.ink}" opacity="0.25"/>` +
    `<polygon points="220,330 200,250 250,260" fill="${p.ink}" opacity="0.18"/>` +
    // Crease lines
    `<polyline points="70,220 200,250 220,330" fill="none" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="1.2" opacity="0.65"/>` +
    `<line x1="200" y1="250" x2="330" y2="120" stroke="#FFFFFF" stroke-width="1" opacity="0.6"/>`
  );
}

// Bulb (idea) ──────────────────────────────────────────────────────────────
function lightbulb(p: ScenePalette, id: string): string {
  return (
    // Glow
    `<circle cx="200" cy="170" r="90" fill="${p.accent}" opacity="0.22" filter="url(%23glow-${id})"/>` +
    // Bulb glass
    `<circle cx="200" cy="170" r="70" fill="url(%23accent-${id})" filter="url(%23dsLg-${id})"/>` +
    `<circle cx="200" cy="170" r="70" fill="url(%23hl-${id})" opacity="0.7"/>` +
    // Filament
    `<path d="M175 150 Q200 130 225 150 M180 170 L220 170 M180 185 L220 185" stroke="${darkenHex(p.accent, 0.4)}" stroke-width="2.5" fill="none" opacity="0.8"/>` +
    // Screw base
    `<path d="M170 220 L230 220 L230 255 L170 255 Z" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<path d="M170 230 L230 230 M170 240 L230 240 M170 250 L230 250" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="1.5"/>` +
    `<rect x="175" y="260" width="50" height="8" rx="2" fill="${p.ink}"/>` +
    // Rays
    `<g stroke="${p.accent}" stroke-width="5" stroke-linecap="round">` +
      `<path d="M100 170 L70 170"/>` +
      `<path d="M200 70 L200 40"/>` +
      `<path d="M300 170 L330 170"/>` +
      `<path d="M135 105 L110 85"/>` +
      `<path d="M265 105 L290 85"/>` +
    `</g>`
  );
}

// Target ───────────────────────────────────────────────────────────────────
function target(p: ScenePalette, id: string): string {
  return (
    // Outer glow
    `<circle cx="200" cy="210" r="130" fill="${p.accent}" opacity="0.15" filter="url(%23glow-${id})"/>` +
    // Rings
    `<circle cx="200" cy="210" r="110" fill="${p.sky[1]}" filter="url(%23dsLg-${id})"/>` +
    `<circle cx="200" cy="210" r="85"  fill="url(%23subj-${id})"/>` +
    `<circle cx="200" cy="210" r="55"  fill="${p.sky[0]}"/>` +
    `<circle cx="200" cy="210" r="30"  fill="url(%23accent-${id})"/>` +
    `<circle cx="200" cy="210" r="10"  fill="${p.ink}"/>` +
    // Highlights on each ring for depth
    `<path d="M145 180 A75 75 0 0 1 255 180" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.4"/>` +
    // Arrow body with gradient
    `<line x1="75" y1="110" x2="195" y2="205" stroke="${p.ink}" stroke-width="7" stroke-linecap="round" filter="url(%23ds-${id})"/>` +
    `<line x1="75" y1="110" x2="195" y2="205" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" opacity="0.45"/>` +
    // Arrow head
    `<polygon points="195,205 173,193 185,218" fill="${p.ink}"/>` +
    // Fletching (tail feathers)
    `<polygon points="75,110 60,100 62,122 77,125" fill="${p.accent}"/>` +
    `<polygon points="75,110 65,125 55,115 65,102" fill="${p.accent}" opacity="0.8"/>`
  );
}

// Megaphone ────────────────────────────────────────────────────────────────
function megaphone(p: ScenePalette, id: string): string {
  return (
    // Body
    `<path d="M100 180 L100 260 L200 260 L280 320 L280 120 L200 180 Z" fill="url(%23subj-${id})" filter="url(%23dsLg-${id})"/>` +
    // Interior shadow
    `<path d="M200 180 L280 120 L280 320 L200 260 Z" fill="${p.ink}" opacity="0.25"/>` +
    // Handle
    `<rect x="70" y="200" width="30" height="40" fill="url(%23accent-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="72" y="202" width="26" height="4" fill="#FFFFFF" opacity="0.5"/>` +
    // Sound waves — three arcs radiating out
    `<g stroke="${p.accent}" stroke-linecap="round" fill="none">` +
      `<path d="M300 150 Q330 180 330 220 Q330 260 300 290" stroke-width="5"/>` +
      `<path d="M320 130 Q360 175 360 220 Q360 265 320 310" stroke-width="4" opacity="0.75"/>` +
      `<path d="M340 110 Q390 170 390 220 Q390 270 340 330" stroke-width="3" opacity="0.5"/>` +
    `</g>` +
    // Sparkle bursts near sound waves
    `<g fill="${p.accent}" opacity="0.85">` +
      `<circle cx="315" cy="140" r="3"/>` +
      `<circle cx="345" cy="170" r="2"/>` +
      `<circle cx="325" cy="300" r="3"/>` +
    `</g>`
  );
}

// Sparkle accents ──────────────────────────────────────────────────────────
function sparkles(p: ScenePalette): string {
  const s = (cx: number, cy: number, size: number, color: string) =>
    `<path fill="${color}" d="M${cx} ${cy - size}l${size * 0.3} ${size * 0.7}l${size * 0.7} ${size * 0.3}l-${size * 0.7} ${size * 0.3}l-${size * 0.3} ${size * 0.7}l-${size * 0.3} -${size * 0.7}l-${size * 0.7} -${size * 0.3}l${size * 0.7} -${size * 0.3}z"/>`;
  return s(60, 90, 10, p.accent) + s(340, 140, 8, p.accent) + s(350, 50, 12, p.subject) + s(50, 320, 9, p.subject);
}

// Polaroid-framed mountain (travel) ────────────────────────────────────────
function polaroidMountain(p: ScenePalette, id: string): string {
  return (
    // Polaroid card
    `<g transform="rotate(-4 200 200)">` +
      `<rect x="70" y="70" width="260" height="280" fill="#FFFFFF" stroke="${p.ink}" stroke-width="2" opacity="0.98"/>` +
      // Picture window
      `<rect x="90" y="90" width="220" height="180" fill="url(%23sky-${id})"/>` +
      // Mini mountains inside the frame
      `<polygon points="90,270 170,160 250,270" fill="${p.subject}"/>` +
      `<polygon points="170,160 190,180 205,175 225,200 200,230 170,190" fill="#FFFFFF" opacity="0.8"/>` +
      `<polygon points="200,270 280,180 310,270" fill="${p.subject}" opacity="0.8"/>` +
      `<circle cx="260" cy="120" r="22" fill="${p.accent}" opacity="0.95"/>` +
      // Caption
      `<text x="200" y="320" text-anchor="middle" font-family="Caveat, Georgia, serif" font-size="24" fill="${p.ink}" font-style="italic">~ memories ~</text>` +
    `</g>`
  );
}

// Floral wreath (beauty / wellness) ────────────────────────────────────────
function floralWreath(p: ScenePalette): string {
  const flower = (cx: number, cy: number, r: number, color: string) =>
    Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * r * 0.6;
      const py = cy + Math.sin(a) * r * 0.6;
      return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r * 0.5}" fill="${color}" opacity="0.9"/>`;
    }).join("") +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.35}" fill="#FFF8E1"/>`;

  const leaf = (cx: number, cy: number, angle: number) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="14" ry="28" fill="${p.ground[0]}" transform="rotate(${angle} ${cx} ${cy})" opacity="0.85"/>`;

  return (
    `<circle cx="200" cy="200" r="110" fill="none" stroke="${p.ground[1]}" stroke-width="2" opacity="0.4"/>` +
    flower(100, 200, 28, p.subject) +
    flower(300, 200, 28, p.accent) +
    flower(200, 95,  28, p.subject) +
    flower(200, 305, 28, p.accent) +
    flower(128, 128, 22, p.accent) +
    flower(272, 128, 22, p.subject) +
    flower(128, 272, 22, p.accent) +
    flower(272, 272, 22, p.subject) +
    leaf(160, 105, -30) + leaf(240, 105, 30) +
    leaf(105, 160, -60) + leaf(295, 160,  60) +
    leaf(105, 240, -120) + leaf(295, 240, 120) +
    leaf(160, 295, -150) + leaf(240, 295, 150)
  );
}

// Workout scene — bench + weights + foliage backdrop (fitness) ────────────
function workoutScene(p: ScenePalette): string {
  return (
    // Background foliage
    `<ellipse cx="60"  cy="240" rx="60" ry="90" fill="${p.ground[1]}" opacity="0.7"/>` +
    `<ellipse cx="340" cy="240" rx="60" ry="90" fill="${p.ground[1]}" opacity="0.7"/>` +
    // Bench
    `<rect x="100" y="250" width="200" height="20" rx="4" fill="${p.subject}"/>` +
    `<rect x="110" y="270" width="14" height="40" fill="${p.ink}"/>` +
    `<rect x="276" y="270" width="14" height="40" fill="${p.ink}"/>` +
    // Barbell
    `<rect x="80" y="210" width="240" height="8" rx="2" fill="${p.ink}"/>` +
    // Weight plates
    `<circle cx="80"  cy="214" r="28" fill="${p.accent}" stroke="${p.ink}" stroke-width="2"/>` +
    `<circle cx="80"  cy="214" r="10" fill="${p.ink}"/>` +
    `<circle cx="320" cy="214" r="28" fill="${p.accent}" stroke="${p.ink}" stroke-width="2"/>` +
    `<circle cx="320" cy="214" r="10" fill="${p.ink}"/>` +
    // Decorative dumbbell in corner
    `<rect x="30" y="340" width="60" height="8" rx="2" fill="${p.ink}"/>` +
    `<rect x="20" y="332" width="16" height="24" rx="3" fill="${p.subject}"/>` +
    `<rect x="84" y="332" width="16" height="24" rx="3" fill="${p.subject}"/>` +
    sparkles(p)
  );
}

// Script banner — cursive "Motivation" text over a decorative underline ──
function scriptBanner(p: ScenePalette): string {
  return (
    `<rect x="40" y="140" width="320" height="120" rx="12" fill="${p.ground[0]}" opacity="0.3"/>` +
    `<text x="200" y="210" text-anchor="middle" font-family="'Great Vibes', 'Brush Script MT', cursive" ` +
      `font-size="72" fill="${p.subject}">Motivation</text>` +
    `<path d="M90 235 Q200 250 310 235" stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M180 320 q 10 -25 20 0 q 10 -25 20 0" stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    sparkles(p)
  );
}

// Confidence spark — bolt + gradient glow (motivation) ────────────────────
function confidenceSpark(p: ScenePalette): string {
  return (
    // Glow
    `<circle cx="200" cy="200" r="140" fill="${p.accent}" opacity="0.15"/>` +
    `<circle cx="200" cy="200" r="100" fill="${p.accent}" opacity="0.25"/>` +
    // Lightning bolt
    `<polygon points="215,80 145,215 195,215 170,320 260,175 205,175 230,80" ` +
      `fill="${p.accent}" stroke="${p.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    sparkles(p)
  );
}

// Diet plate — healthy food arranged on a plate (wellness / education) ───
function dietPlate(p: ScenePalette): string {
  return (
    // Plate
    `<circle cx="200" cy="220" r="130" fill="#FFFFFF" stroke="${p.ink}" stroke-width="3"/>` +
    `<circle cx="200" cy="220" r="110" fill="${p.sky[0]}"/>` +
    // Food items (abstract polychrome shapes)
    `<circle cx="150" cy="180" r="28" fill="#DC2626"/>` +         // tomato
    `<circle cx="150" cy="180" r="10" fill="#FBBF24"/>` +         // tomato highlight
    `<ellipse cx="250" cy="175" rx="34" ry="22" fill="${p.ground[0]}"/>` + // leafy
    `<path d="M250 150 Q258 170 252 195" stroke="${p.ink}" stroke-width="2" fill="none"/>` +
    `<path d="M130 240 Q200 230 270 240 L265 280 Q200 295 135 280 Z" fill="${p.accent}"/>` + // crescent bread
    `<circle cx="200" cy="270" r="16" fill="${p.subject}"/>` +    // protein
    `<circle cx="200" cy="270" r="7"  fill="${p.accent}"/>` +
    // Fork
    `<rect x="40" y="180" width="6" height="80" fill="${p.ink}"/>` +
    `<path d="M30 160 L30 200 M40 160 L40 200 M50 160 L50 200" stroke="${p.ink}" stroke-width="3"/>` +
    sparkles(p)
  );
}

// ── Step 43: Six new high-quality scene kinds ────────────────────────────

// Yoga pose — silhouette in warrior position with halo glow (wellness)
function yogaPose(p: ScenePalette, id: string): string {
  return (
    `<circle cx="200" cy="190" r="120" fill="${p.accent}" opacity="0.18" filter="url(%23glow-${id})"/>` +
    // Ground mat
    `<rect x="80" y="300" width="240" height="14" rx="4" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<rect x="82" y="302" width="236" height="3" fill="#FFFFFF" opacity="0.3"/>` +
    // Silhouette (warrior II — arms out, legs braced)
    `<g fill="url(%23subj-${id})" filter="url(%23ds-${id})">` +
      // Head
      `<circle cx="200" cy="100" r="22"/>` +
      // Torso
      `<path d="M200 125 Q178 140 180 200 L220 200 Q222 140 200 125 Z"/>` +
      // Arms (out wide)
      `<path d="M110 175 L180 165 L195 180 L190 195 L110 200 Z"/>` +
      `<path d="M290 175 L220 165 L205 180 L210 195 L290 200 Z"/>` +
      // Legs (stance)
      `<path d="M182 200 L155 295 L175 300 L195 210 Z"/>` +
      `<path d="M218 200 L245 295 L225 300 L205 210 Z"/>` +
    `</g>` +
    // Breath circle
    `<circle cx="200" cy="100" r="32" stroke="${p.accent}" stroke-width="2" fill="none" opacity="0.45"/>` +
    `<circle cx="200" cy="100" r="42" stroke="${p.accent}" stroke-width="1.5" fill="none" opacity="0.25"/>`
  );
}

// Coffee mug with steam — productivity / marketing morning vibe
function coffeeMug(p: ScenePalette, id: string): string {
  return (
    // Saucer shadow
    `<ellipse cx="200" cy="330" rx="90" ry="10" fill="${p.ink}" opacity="0.28"/>` +
    // Steam wisps
    `<g stroke="${p.ink}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.5">` +
      `<path d="M175 90 Q165 70 175 50 Q185 30 175 10"/>` +
      `<path d="M200 80 Q190 60 200 40 Q210 20 200 0"/>` +
      `<path d="M225 90 Q215 70 225 50 Q235 30 225 10"/>` +
    `</g>` +
    // Mug body
    `<path d="M135 140 L265 140 L255 310 Q200 325 145 310 Z" fill="url(%23subj-${id})" filter="url(%23dsLg-${id})"/>` +
    // Coffee surface
    `<ellipse cx="200" cy="145" rx="62" ry="12" fill="${darkenHex(p.ink, 0.0)}"/>` +
    `<ellipse cx="200" cy="143" rx="58" ry="8" fill="${darkenHex(p.subject, 0.3)}"/>` +
    `<ellipse cx="195" cy="142" rx="18" ry="4" fill="#FFFFFF" opacity="0.25"/>` +
    // Mug handle
    `<path d="M265 180 Q310 180 310 235 Q310 285 265 285" stroke="url(%23subj-${id})" stroke-width="22" fill="none" filter="url(%23ds-${id})"/>` +
    // Highlight strip
    `<rect x="145" y="160" width="8" height="130" rx="4" fill="#FFFFFF" opacity="0.35"/>` +
    // Saucer
    `<ellipse cx="200" cy="322" rx="100" ry="14" fill="url(%23subj-${id})" filter="url(%23ds-${id})"/>` +
    `<ellipse cx="200" cy="320" rx="88"  ry="8"  fill="${darkenHex(p.subject, 0.2)}"/>`
  );
}

// Calendar day — single tear-off date block (productivity)
function calendarDay(p: ScenePalette, id: string): string {
  return (
    // Back shadow card
    `<rect x="112" y="122" width="176" height="196" rx="14" fill="${p.ink}" opacity="0.22"/>` +
    // Main card
    `<rect x="108" y="118" width="184" height="200" rx="14" fill="#FFFFFF" filter="url(%23dsLg-${id})" stroke="${darkenHex(p.ink, 0.0)}" stroke-width="1.5"/>` +
    // Red/accent header strip
    `<path d="M108 118 Q108 118 122 118 L278 118 Q292 118 292 132 L292 168 L108 168 Z" fill="url(%23accent-${id})"/>` +
    // Rings (tear holes)
    `<circle cx="148" cy="118" r="8" fill="${p.ink}"/>` +
    `<circle cx="200" cy="118" r="8" fill="${p.ink}"/>` +
    `<circle cx="252" cy="118" r="8" fill="${p.ink}"/>` +
    // Month
    `<text x="200" y="155" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF" letter-spacing="4">TODAY</text>` +
    // Big date
    `<text x="200" y="250" text-anchor="middle" font-family="Inter, sans-serif" font-size="88" font-weight="900" fill="${p.subject}">24</text>` +
    // Day of week
    `<text x="200" y="290" text-anchor="middle" font-family="Inter, sans-serif" font-size="16" font-weight="700" fill="${darkenHex(p.subject, 0.2)}" letter-spacing="3">MONDAY</text>` +
    // Check mark accent
    `<circle cx="325" cy="280" r="22" fill="url(%23accent-${id})" filter="url(%23ds-${id})"/>` +
    `<path d="M314 280 L322 288 L338 272" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

// Brain with sparks — education / productivity think-mode
function brainSparks(p: ScenePalette, id: string): string {
  return (
    // Halo
    `<circle cx="200" cy="200" r="150" fill="${p.accent}" opacity="0.15" filter="url(%23glow-${id})"/>` +
    // Brain body (two lobes)
    `<g filter="url(%23dsLg-${id})">` +
      `<path d="M120 180 Q110 140 140 125 Q160 110 180 120 Q185 100 205 100 Q225 100 230 120 Q250 110 270 125 Q300 140 290 180 Q310 190 300 230 Q310 260 275 275 Q265 300 230 290 Q215 310 195 300 Q175 310 165 290 Q130 300 115 275 Q95 260 105 230 Q90 195 120 180 Z" ` +
        `fill="url(%23subj-${id})"/>` +
      // Central fissure
      `<path d="M200 105 Q195 180 200 295" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="2.5" fill="none"/>` +
      // Left convolutions
      `<path d="M150 160 Q170 170 160 200 Q140 210 150 240" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="2" fill="none" opacity="0.7"/>` +
      `<path d="M125 200 Q145 205 130 240" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="2" fill="none" opacity="0.7"/>` +
      // Right convolutions
      `<path d="M250 160 Q230 170 240 200 Q260 210 250 240" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="2" fill="none" opacity="0.7"/>` +
      `<path d="M275 200 Q255 205 270 240" stroke="${darkenHex(p.subject, 0.3)}" stroke-width="2" fill="none" opacity="0.7"/>` +
    `</g>` +
    // Highlight
    `<ellipse cx="175" cy="150" rx="35" ry="22" fill="#FFFFFF" opacity="0.35"/>` +
    // Spark particles around
    `<g fill="${p.accent}">` +
      `<path d="M80 100 L90 110 L80 120 L70 110 Z"/>` +
      `<path d="M320 80 L330 90 L320 100 L310 90 Z"/>` +
      `<circle cx="90" cy="250" r="5"/>` +
      `<circle cx="310" cy="270" r="5"/>` +
      `<path d="M350 150 L358 158 L350 166 L342 158 Z"/>` +
    `</g>`
  );
}

// Confetti burst — marketing / celebration
function confettiBurst(p: ScenePalette, id: string): string {
  const piece = (cx: number, cy: number, color: string, rot: number, shape: "rect" | "circle" | "tri") => {
    if (shape === "rect") return `<rect x="${cx - 4}" y="${cy - 10}" width="8" height="20" fill="${color}" transform="rotate(${rot} ${cx} ${cy})"/>`;
    if (shape === "circle") return `<circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>`;
    return `<polygon points="${cx},${cy - 8} ${cx + 8},${cy + 8} ${cx - 8},${cy + 8}" fill="${color}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  };
  // Center star
  const star =
    `<g filter="url(%23dsLg-${id})">` +
      `<polygon points="200,80 218,150 290,150 232,190 252,265 200,220 148,265 168,190 110,150 182,150" ` +
        `fill="url(%23accent-${id})"/>` +
      `<polygon points="200,80 212,145 200,200" fill="#FFFFFF" opacity="0.35"/>` +
    `</g>`;
  return (
    `<circle cx="200" cy="175" r="180" fill="${p.accent}" opacity="0.12" filter="url(%23glow-${id})"/>` +
    star +
    piece(60, 80, p.subject, 20, "rect") +
    piece(90, 120, p.accent, -15, "circle") +
    piece(340, 90, p.subject, 40, "rect") +
    piece(310, 140, p.accent, 30, "tri") +
    piece(70, 280, p.accent, 50, "rect") +
    piece(120, 340, p.subject, 70, "circle") +
    piece(280, 340, p.accent, -40, "tri") +
    piece(340, 290, p.subject, -20, "rect") +
    piece(40, 200, p.accent, 15, "circle") +
    piece(360, 220, p.subject, 80, "rect") +
    // Curly ribbons
    `<path d="M50 150 Q80 170 100 150 Q120 130 150 160" stroke="${p.subject}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M250 330 Q270 310 290 330 Q310 350 330 310" stroke="${p.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`
  );
}

// Map with compass — travel / explore
function mapCompass(p: ScenePalette, id: string): string {
  return (
    // Map paper
    `<g filter="url(%23dsLg-${id})">` +
      `<path d="M60 100 L340 85 L335 310 L55 320 Z" fill="#FFFBEB" stroke="${darkenHex(p.ink, 0.0)}" stroke-width="1.5"/>` +
      // Fold crease
      `<path d="M200 92 L198 315" stroke="${p.ink}" stroke-width="1" opacity="0.15" stroke-dasharray="3 4"/>` +
      `<path d="M60 200 L340 195" stroke="${p.ink}" stroke-width="1" opacity="0.15" stroke-dasharray="3 4"/>` +
    `</g>` +
    // Roads
    `<path d="M80 300 Q130 260 180 280 Q230 300 280 250 Q320 220 325 130" stroke="${p.accent}" stroke-width="4" fill="none" stroke-linecap="round" stroke-dasharray="6 6"/>` +
    // Mini mountains
    `<polygon points="75,200 100,160 125,200" fill="${p.ground[1]}" opacity="0.7"/>` +
    `<polygon points="110,250 140,210 170,250" fill="${p.ground[0]}" opacity="0.7"/>` +
    // Location pin
    `<g filter="url(%23ds-${id})">` +
      `<path d="M200 130 Q235 130 235 165 Q235 200 200 250 Q165 200 165 165 Q165 130 200 130 Z" fill="url(%23subj-${id})"/>` +
      `<circle cx="200" cy="165" r="12" fill="#FFFFFF"/>` +
      `<circle cx="200" cy="165" r="6" fill="${darkenHex(p.subject, 0.3)}"/>` +
    `</g>` +
    // Compass rose (bottom right)
    `<g transform="translate(320 280)">` +
      `<circle r="30" fill="#FFFFFF" stroke="${p.ink}" stroke-width="2" filter="url(%23ds-${id})"/>` +
      `<polygon points="0,-25 6,0 0,25 -6,0" fill="${p.accent}"/>` +
      `<polygon points="0,-25 6,0 -6,0" fill="${darkenHex(p.accent, 0.35)}"/>` +
      `<text y="-10" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="700" fill="${p.ink}">N</text>` +
    `</g>`
  );
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
  | "cloudscape"
  // Step 41: richer compositions
  | "polaroid-mountain"
  | "floral-wreath"
  | "workout-scene"
  | "script-banner"
  | "confidence-spark"
  | "diet-plate"
  // Step 43: premium scene additions
  | "yoga-pose"
  | "coffee-mug"
  | "calendar-day"
  | "brain-sparks"
  | "confetti-burst"
  | "map-compass";

interface SceneBuilder {
  build(p: ScenePalette, id: string): string;
  aspectRatio: number;
}

const SCENES: Record<SceneKind, SceneBuilder> = {
  "mountain-sunrise": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithSun(p, id) + groundHills(p, id) + peaks(p, id) + sparkles(p);
    },
  },
  "plant-potted": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + pottedPlant(p, id) + sparkles(p);
    },
  },
  "heart-centered": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + heartShape(p, id) + sparkles(p);
    },
  },
  "dumbbell-rack": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + dumbbell(p, id);
    },
  },
  "trophy-podium": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithSun(p, id) + groundFlat(id) + trophy(p, id) + sparkles(p);
    },
  },
  "books-stack": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + booksStack(p, id) + sparkles(p);
    },
  },
  "water-bottle": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + waterBottle(p, id);
    },
  },
  "paper-plane": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithClouds(p, id) + groundHills(p, id) + paperPlane(p, id);
    },
  },
  "idea-bulb": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + lightbulb(p, id) + sparkles(p);
    },
  },
  "target-arrow": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + target(p, id);
    },
  },
  "megaphone-launch": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyWithClouds(p, id) + groundFlat(id) + megaphone(p, id) + sparkles(p);
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
      return defsGradients(p, id) + skyWithClouds(p, id) + groundHills(p, id) + peaks(p, id);
    },
  },
  "polaroid-mountain": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) +
        `<rect width="400" height="400" fill="${p.ground[0]}"/>` +
        polaroidMountain(p, id) + sparkles(p);
    },
  },
  "floral-wreath": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + floralWreath(p);
    },
  },
  "workout-scene": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + workoutScene(p);
    },
  },
  "script-banner": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + scriptBanner(p);
    },
  },
  "confidence-spark": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + confidenceSpark(p);
    },
  },
  "diet-plate": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + dietPlate(p);
    },
  },
  "yoga-pose": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + groundFlat(id) + yogaPose(p, id) + sparkles(p);
    },
  },
  "coffee-mug": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + coffeeMug(p, id);
    },
  },
  "calendar-day": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + calendarDay(p, id);
    },
  },
  "brain-sparks": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + brainSparks(p, id);
    },
  },
  "confetti-burst": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + confettiBurst(p, id);
    },
  },
  "map-compass": {
    aspectRatio: 1,
    build(p, id) {
      return defsGradients(p, id) + skyFlat(p, id) + mapCompass(p, id);
    },
  },
};

// ── Public render ────────────────────────────────────────────────────────────

/**
 * Render a scene to a complete inline SVG string.
 *
 *   renderScene("mountain-sunrise", "motivation")
 *   renderScene("mountain-sunrise", "motivation", 2) // palette variant 2
 *
 * The returned string is a self-contained <svg>…</svg> ready to drop
 * into an Asset payload with format="svg". No external dependencies,
 * no URL fetches — deterministic and offline-safe.
 *
 * Step 41: results are memoized by (kind, category, variant). For a
 * gallery batch that reuses the same hero scene across multiple
 * candidates, the second+ calls return the cached string immediately
 * — composition is deterministic so the output is identical anyway.
 */
const _sceneCache = new Map<string, string>();

export function renderScene(
  kind:     SceneKind,
  category: string,
  variant:  number = 0,
): string {
  const cacheKey = `${kind}|${category}|${variant}`;
  const cached = _sceneCache.get(cacheKey);
  if (cached) return cached;

  const builder = SCENES[kind];
  const palette = getScenePalette(category, variant);
  const id = `${kind}_${category}_${variant}_${Math.abs(hashCode(cacheKey))}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${builder.build(palette, id)}</svg>`;

  // Bounded cache — scene combinations are small (19 kinds × 9
  // categories × 3 variants ≈ 500 entries max). Drop oldest when we
  // hit a safety ceiling to prevent runaway growth in pathological
  // cases (e.g. unknown categories each creating a new palette).
  if (_sceneCache.size > 1024) {
    const firstKey = _sceneCache.keys().next().value;
    if (firstKey !== undefined) _sceneCache.delete(firstKey);
  }
  _sceneCache.set(cacheKey, svg);
  return svg;
}

// Test / benchmark helper. Lets the benchmark reset between runs so
// cold-cache numbers reflect real first-render latency.
export function clearSceneCache(): void {
  _sceneCache.clear();
}

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}
