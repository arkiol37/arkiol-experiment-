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
  | "diet-plate";

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

// Test / debug helper — lets callers verify cache warmth.
export function getSceneCacheSize(): number { return _sceneCache.size; }
export function clearSceneCache():  void   { _sceneCache.clear(); }

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
