// src/engines/layout/section-structure.ts
//
// STRUCTURED SECTION LAYOUT ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
// Arkiol's layout families define zones as flat positioned rectangles.
// That made it possible for the composer to ship templates where a single
// floating text block was the only populated element — no header, no CTA,
// no visual balance. Gallery outputs felt amateur as a result.
//
// This module adds an explicit *section* layer on top of the zone system:
//
//   SectionKind ∈ { header | content | visual | list_block | cta | supporting }
//
// Each active zone is classified by id + position into one of six
// sections. A template is considered structurally valid only if 2–4
// distinct sections are present AND at least one of them is a
// high-weight section (header / content / cta). Templates that would
// render as a single floating block are flagged by the validators so
// the rejection gate can drop them, and the band helper can snap zones
// to canonical Y bands to keep the composition tidy.
//
// The module is used in two places:
//   1. pipeline.ts — right after the layout spec is finalized. Adds
//      structural violations and (when possible) snaps zones to bands.
//   2. rejection-rules.ts — a new `single_block` hard rule that reads
//      the populated text contents and refuses templates that don't
//      span at least two sections.
//
// The enforcer is deliberately lightweight: it never deletes zones,
// never invents new ones, and never changes zone ids. It only
// classifies, reports, and (optionally) nudges Y coordinates so zones
// already grouped in the same role sit on a shared band.

import type { Zone, ZoneId } from "./families";

// ── Section taxonomy ─────────────────────────────────────────────────────────

export type SectionKind =
  | "header"        // eyebrow / badge / section header / short lead line
  | "content"       // headline / subhead / body / tagline / bio / name+title
  | "visual"        // image / photo / accent graphic block
  | "list_block"    // bullet_1/2/3 / checklist-style stacks
  | "cta"           // cta / price
  | "supporting";   // logo / legal / contact / company / background

/** Zone ids that structurally belong to a single section regardless of position. */
const ZONE_SECTION_MAP: Partial<Record<ZoneId, SectionKind>> = {
  // Section-defining identifiers
  badge:          "header",
  section_header: "header",

  // Content body
  headline:       "content",
  subhead:        "content",
  body:           "content",
  tagline:        "content",
  name:           "content",
  title:          "content",

  // Lists
  bullet_1:       "list_block",
  bullet_2:       "list_block",
  bullet_3:       "list_block",

  // Visuals
  image:          "visual",
  accent:         "visual",

  // Call-to-action cluster
  cta:            "cta",
  price:          "cta",

  // Supporting / peripheral
  logo:           "supporting",
  company:        "supporting",
  contact:        "supporting",
  legal:          "supporting",
  background:     "supporting",
} as const;

/** Section kinds that constitute a real composition anchor. A template
 *  must contain at least one of these to be considered structured. */
export const ANCHOR_SECTIONS: ReadonlySet<SectionKind> = new Set([
  "header", "content", "cta", "visual",
]);

/** Canonical Y bands used by `enforceSectionBands`. These are soft hints
 *  — only zones whose current Y already falls within a band's zone are
 *  snapped to its midline so we don't warp custom variations. */
const SECTION_BANDS: Record<SectionKind, { y: number; range: [number, number] }> = {
  header:      { y: 8,   range: [0,  20]  },
  content:     { y: 38,  range: [20, 62]  },
  visual:      { y: 30,  range: [0, 100]  }, // visuals span — don't snap
  list_block:  { y: 58,  range: [38, 80]  },
  cta:         { y: 86,  range: [72, 100] },
  supporting:  { y: 92,  range: [80, 100] },
};

// ── Classification ───────────────────────────────────────────────────────────

export function classifyZoneSection(zone: Zone): SectionKind {
  const byId = ZONE_SECTION_MAP[zone.id];
  if (byId) return byId;

  // Position-based fallback for zones without an id in the map.
  const yCenter = zone.y + zone.height / 2;
  if (yCenter < 20)  return "header";
  if (yCenter < 65)  return "content";
  if (yCenter < 82)  return "cta";
  return "supporting";
}

/** Id-only classifier — used by rejection rules which only see populated
 *  zone ids, not the full zone geometry. Unknown ids fall back to
 *  "content" so new zones don't silently degrade the section count. */
export function classifyZoneIdSection(id: string): SectionKind {
  const known = ZONE_SECTION_MAP[id as ZoneId];
  return known ?? "content";
}

// ── Section analysis ─────────────────────────────────────────────────────────

export interface SectionReport {
  /** All active zones bucketed by section. */
  sections:         Record<SectionKind, Zone[]>;
  /** Sections with at least one zone. Order matches presence. */
  presentSections:  SectionKind[];
  /** Count of present sections (0..6). */
  count:            number;
  /** Count of present *anchor* sections (header/content/cta/visual). */
  anchorCount:      number;
  /** True when only one section holds zones — the classic floating-text failure. */
  isSingleBlock:    boolean;
  /** True when the layout satisfies the 2–4 sections requirement. */
  satisfiesMinimum: boolean;
  /** Human-readable violations the caller can forward to the audit log. */
  issues:           string[];
}

/** Minimum section count demanded by the structural rule. */
export const MIN_SECTIONS = 2;
export const MAX_SECTIONS = 4;
/** At least one anchor section (header / content / cta / visual) must carry weight. */
const MIN_ANCHOR_SECTIONS = 1;

export function analyzeSectionStructure(
  zones:         Zone[],
  activeZoneIds: readonly string[] = zones.map(z => z.id),
): SectionReport {
  const activeSet = new Set(activeZoneIds);
  const sections: Record<SectionKind, Zone[]> = {
    header: [], content: [], visual: [], list_block: [], cta: [], supporting: [],
  };

  for (const z of zones) {
    if (!activeSet.has(z.id)) continue;
    // Background is always present but never contributes to structure.
    if (z.id === "background") continue;
    // Zones collapsed to zero area (e.g., image in text-only variation)
    // don't count — they won't render.
    if (z.width <= 0.5 || z.height <= 0.5) continue;
    const kind = classifyZoneSection(z);
    sections[kind].push(z);
  }

  const presentSections = (Object.keys(sections) as SectionKind[])
    .filter(k => sections[k].length > 0);
  const count        = presentSections.length;
  const anchorCount  = presentSections.filter(k => ANCHOR_SECTIONS.has(k)).length;
  const isSingleBlock = count <= 1;
  const satisfiesMinimum =
    count >= MIN_SECTIONS && anchorCount >= MIN_ANCHOR_SECTIONS;

  const issues: string[] = [];
  if (isSingleBlock) {
    issues.push(`single_block:only_${presentSections[0] ?? "empty"}_section`);
  }
  if (!isSingleBlock && count < MIN_SECTIONS) {
    issues.push(`insufficient_sections:${count}/${MIN_SECTIONS}`);
  }
  if (anchorCount < MIN_ANCHOR_SECTIONS) {
    issues.push(`no_anchor_section`);
  }

  return { sections, presentSections, count, anchorCount, isSingleBlock, satisfiesMinimum, issues };
}

// ── Band discipline ──────────────────────────────────────────────────────────
// Snap zones whose current center-Y already falls in a canonical band to
// that band's center line. Discipline without disruption: only nudges
// within ±4% so variations like "bottom third" or "centered overlay"
// stay distinct. Returns the updated zone list plus the list of zone
// ids that were nudged.

export function enforceSectionBands(zones: Zone[]): { zones: Zone[]; nudged: string[] } {
  const nudged: string[] = [];
  const NUDGE_CAP = 4; // %
  const adjusted: Zone[] = zones.map(z => {
    const kind = classifyZoneSection(z);
    if (kind === "visual" || kind === "supporting") return z;
    const band = SECTION_BANDS[kind];
    const yCenter = z.y + z.height / 2;
    if (yCenter < band.range[0] || yCenter > band.range[1]) return z;
    const delta = band.y - yCenter;
    if (Math.abs(delta) < 0.5 || Math.abs(delta) > NUDGE_CAP) return z;
    nudged.push(z.id);
    return { ...z, y: Math.max(0, Math.min(100 - z.height, z.y + delta)) };
  });
  return { zones: adjusted, nudged };
}

// ── Content-level validation ─────────────────────────────────────────────────
// After the composer has populated text into zones, validate that the
// *populated* content spans multiple sections. A layout spec with five
// zones can still render as a single block if four of them ended up empty.
// This is the final guard the rejection gate calls.

export interface ContentSectionReport {
  populatedSections: SectionKind[];
  count:             number;
  anchorCount:       number;
  isSingleBlock:     boolean;
  satisfiesMinimum:  boolean;
}

export function analyzePopulatedSections(
  populated: Array<{ zoneId: string; text: string }>,
): ContentSectionReport {
  const sections = new Set<SectionKind>();
  for (const p of populated) {
    if (!p.text || p.text.trim().length === 0) continue;
    sections.add(classifyZoneIdSection(p.zoneId));
  }

  const populatedSections = [...sections];
  const count        = populatedSections.length;
  const anchorCount  = populatedSections.filter(k => ANCHOR_SECTIONS.has(k)).length;
  const isSingleBlock = count <= 1;
  const satisfiesMinimum =
    count >= MIN_SECTIONS && anchorCount >= MIN_ANCHOR_SECTIONS;

  return { populatedSections, count, anchorCount, isSingleBlock, satisfiesMinimum };
}

// ── Summary helpers ──────────────────────────────────────────────────────────

export function sectionReportSummary(r: SectionReport): string {
  const bits = r.presentSections.map(k => `${k}:${r.sections[k].length}`);
  return `[${bits.join(",")}] anchors=${r.anchorCount}/${r.count}`;
}
