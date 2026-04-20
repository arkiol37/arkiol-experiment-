// src/engines/components/content-component-mapper.ts
//
// STEP 8 — Map OpenAI structured content → visual components.
//
// What this module does
// ─────────────────────────────────────────────────────────────────────────────
// Step 7 produces a StructuredContent (headline, subhead, cta, badge,
// eyebrow, attribution, supporting, items[]). Before Step 8 that payload
// got flattened by a generic `structuredContentToTextMap` that greedily
// reused fields (supporting → section_header AND tagline AND body) and
// had no notion of "each item should render as its own component".
// The consequence was that lists collapsed into one zone and secondary
// fields quietly vanished, which is exactly the failure mode the Step 8
// brief calls out.
//
// This mapper replaces that stringly-typed fallback with a declarative
// role-based contract:
//
//   role ∈ {headline, subhead, cta, item, badge, eyebrow,
//           attribution, supporting, title, name}
//
// Each template type declares:
//   - which roles MUST render (headline + primary list for list-style
//     templates, headline for headline-first templates)
//   - which roles are OPTIONAL (badge, eyebrow, attribution, supporting)
//   - a preferred zone list per role, resolved against the canvas's
//     actually-available zones
//   - the expected item count (derived from StructuredContent.items)
//
// The mapper walks every role, picks the first available zone, and emits
// a ComponentSlot tying (zoneId, kind, role, title, supporting?, index?)
// together. The result is:
//   - a zone→text map for the existing rendering pipeline (drop-in
//     replacement for structuredContentToTextMap)
//   - a MappingCoverageReport stamped on SvgContent._contentMapping
//     that enables three new rejection rules (unmapped_content,
//     underfilled_components, compressed_content)
//
// What this module does NOT do
// ─────────────────────────────────────────────────────────────────────────────
// No layout, typography, colour, or SVG drawing. Component backplates
// still come from component-system.ts — this module only decides WHICH
// content field lands in WHICH zone with WHICH role, and records whether
// every required role was actually placed.

import type { TemplateType }        from "../templates/template-types";
import type { StructuredContent }   from "../ai/structured-content";
import type { ComponentKind }       from "./component-system";

// ── Roles & slot shape ──────────────────────────────────────────────────────

export type ContentRole =
  | "headline"
  | "subhead"
  | "cta"
  | "item"
  | "badge"
  | "eyebrow"
  | "attribution"
  | "supporting"
  | "title"
  | "name";

/** One placed field. The renderer receives `zoneId → title` via toTextMap;
 *  the slot itself carries extra metadata for audits / future layering. */
export interface ComponentSlot {
  zoneId:     string;
  role:       ContentRole;
  /** Intended component kind for the backplate — kept in sync with
   *  component-system.TEMPLATE_COMPONENT_MAP so analyzers line up. */
  kind:       ComponentKind;
  /** Primary visible text. Matches the zone's main text layer. */
  title:      string;
  /** Optional second text layer (e.g. step label under a step title). */
  supporting?: string;
  /** 1-based index for items / steps / checklist entries. */
  index?:     number;
}

/** What coverage we demand from the mapper, per template type. */
interface RoleRequirement {
  role:      ContentRole;
  required:  boolean;
  /** Preferred zone ids for this role, checked in order. The first zone
   *  that exists on the canvas wins. */
  prefer:    string[];
  /** Expected component kind (drives the backplate selection). */
  kind:      ComponentKind;
}

interface TemplateExpectations {
  /** Ordered role requirements. Items are expanded separately. */
  roles:          RoleRequirement[];
  /** Zone ids used for items (bullet_1..bullet_n). */
  itemZones:      string[];
  /** Component kind each item renders as. */
  itemKind:       ComponentKind;
  /** Minimum items required. 0 for headline-first templates. */
  minItems:       number;
  /** Maximum items we will place (caps the zone consumption). */
  maxItems:       number;
}

// ── Per-template contracts ──────────────────────────────────────────────────
//
// Zone preferences are ordered best→worst; the mapper picks the first
// one that the canvas actually provides. This keeps the mapping robust
// across layout families that exclude certain zones (quote layouts
// often drop `subhead`, minimal layouts often drop `body`, etc).

const TEMPLATE_EXPECTATIONS: Record<TemplateType, TemplateExpectations> = {
  checklist: {
    roles: [
      { role: "headline",   required: true,  prefer: ["headline"],                       kind: "labeled_section" },
      { role: "supporting", required: false, prefer: ["subhead", "body", "tagline"],     kind: "content_card" },
      { role: "cta",        required: false, prefer: ["cta"],                            kind: "cta_button" },
      { role: "badge",      required: false, prefer: ["badge"],                          kind: "badge" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "checklist_item",
    minItems:  2,
    maxItems:  3,
  },

  tips: {
    roles: [
      { role: "headline",   required: true,  prefer: ["headline"],                       kind: "labeled_section" },
      { role: "supporting", required: false, prefer: ["subhead", "body", "tagline"],     kind: "content_card" },
      { role: "cta",        required: false, prefer: ["cta"],                            kind: "cta_button" },
      { role: "badge",      required: false, prefer: ["badge"],                          kind: "badge" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "tip_card",
    minItems:  2,
    maxItems:  3,
  },

  quote: {
    roles: [
      // The quote body sits in headline/body/tagline — whichever the
      // quote layout actually exposes — and the attribution in name or
      // title. supporting / subhead are unused here by design.
      { role: "headline",    required: true,  prefer: ["headline", "body", "tagline"],   kind: "quote_box" },
      { role: "attribution", required: false, prefer: ["name", "title", "tagline"],      kind: "content_card" },
      { role: "cta",         required: false, prefer: ["cta"],                           kind: "cta_button" },
    ],
    itemZones: [],
    itemKind:  "content_card",
    minItems:  0,
    maxItems:  0,
  },

  step_by_step: {
    roles: [
      { role: "headline",    required: true,  prefer: ["headline"],                      kind: "labeled_section" },
      { role: "supporting",  required: false, prefer: ["subhead", "body", "tagline"],    kind: "content_card" },
      { role: "cta",         required: false, prefer: ["cta"],                           kind: "cta_button" },
      { role: "badge",       required: false, prefer: ["badge"],                         kind: "badge" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "step_block",
    minItems:  2,
    maxItems:  3,
  },

  list_based: {
    roles: [
      { role: "headline",    required: true,  prefer: ["headline"],                      kind: "labeled_section" },
      { role: "supporting",  required: false, prefer: ["subhead", "body", "tagline"],    kind: "content_card" },
      { role: "cta",         required: false, prefer: ["cta"],                           kind: "cta_button" },
      { role: "badge",       required: false, prefer: ["badge"],                         kind: "badge" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "content_card",
    minItems:  2,
    maxItems:  3,
  },

  promotional: {
    roles: [
      { role: "headline",    required: true,  prefer: ["headline"],                      kind: "labeled_section" },
      { role: "subhead",     required: false, prefer: ["subhead", "body", "tagline"],    kind: "content_card" },
      { role: "cta",         required: true,  prefer: ["cta"],                           kind: "cta_button" },
      { role: "badge",       required: false, prefer: ["badge"],                         kind: "badge" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "content_card",
    minItems:  0,
    maxItems:  3,
  },

  educational: {
    roles: [
      { role: "eyebrow",     required: false, prefer: ["eyebrow", "section_header"],     kind: "labeled_section" },
      { role: "headline",    required: true,  prefer: ["headline"],                      kind: "labeled_section" },
      { role: "supporting",  required: false, prefer: ["subhead", "body", "tagline"],    kind: "content_card" },
      { role: "cta",         required: false, prefer: ["cta"],                           kind: "cta_button" },
    ],
    itemZones: ["bullet_1", "bullet_2", "bullet_3"],
    itemKind:  "tip_card",
    minItems:  2,
    maxItems:  3,
  },

  minimal: {
    roles: [
      { role: "eyebrow",    required: false, prefer: ["eyebrow", "section_header"],      kind: "labeled_section" },
      { role: "headline",   required: true,  prefer: ["headline"],                       kind: "labeled_section" },
      { role: "supporting", required: false, prefer: ["subhead", "body", "tagline"],     kind: "content_card" },
      { role: "cta",        required: false, prefer: ["cta"],                            kind: "cta_button" },
    ],
    itemZones: [],
    itemKind:  "content_card",
    minItems:  0,
    maxItems:  0,
  },
};

// ── Public mapping API ──────────────────────────────────────────────────────

export interface MappingCoverageReport {
  templateType:        TemplateType;
  slots:               ComponentSlot[];
  /** Roles that WERE placed. */
  placedRoles:         ContentRole[];
  /** Roles that were required but could not be placed (no available zone
   *  OR no content for that role). */
  missingRequired:     ContentRole[];
  /** Item count requested by policy (cap from StructuredContent.items). */
  expectedItemCount:   number;
  /** Items actually placed into zones. */
  placedItemCount:     number;
  /** True when the content carried item data but <2 of them landed in
   *  distinct zones — the "list compressed into one area" failure. */
  compressed:          boolean;
  /** True when the mapper placed fewer total slots than the template
   *  contract specifies (required + expected items). Signals that real
   *  content was available but got dropped. */
  underfilled:         boolean;
  /** Distinct zone count with placed content. */
  distinctZoneCount:   number;
}

/**
 * Map a StructuredContent onto the available canvas zones following the
 * per-template contract. Returns the slots, a zone→text map, and a
 * coverage report for audit / rejection gates.
 */
export function mapContentToComponents(
  content:          StructuredContent,
  templateType:     TemplateType,
  availableZoneIds: Set<string>,
): { slots: ComponentSlot[]; textMap: Map<string, string>; report: MappingCoverageReport } {
  const contract  = TEMPLATE_EXPECTATIONS[templateType];
  const slots:    ComponentSlot[] = [];
  const textMap:  Map<string, string> = new Map();
  const usedZones = new Set<string>();

  const placeOnce = (zoneId: string, text: string) => {
    if (!text) return false;
    if (!availableZoneIds.has(zoneId)) return false;
    if (usedZones.has(zoneId)) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    textMap.set(zoneId, trimmed);
    usedZones.add(zoneId);
    return true;
  };

  const placedRoles:     ContentRole[] = [];
  const missingRequired: ContentRole[] = [];

  // Resolve non-item roles.
  for (const req of contract.roles) {
    const text = extractRoleText(content, req.role);
    if (!text) {
      if (req.required) missingRequired.push(req.role);
      continue;
    }
    const zoneId = req.prefer.find(z => availableZoneIds.has(z) && !usedZones.has(z));
    if (!zoneId) {
      if (req.required) missingRequired.push(req.role);
      continue;
    }
    if (!placeOnce(zoneId, text)) {
      if (req.required) missingRequired.push(req.role);
      continue;
    }
    slots.push({ zoneId, role: req.role, kind: req.kind, title: text.trim() });
    placedRoles.push(req.role);
  }

  // Resolve items. Every item gets its own distinct zone — the whole
  // point of Step 8 is preventing the "list collapses into one block"
  // failure.
  const items = (content.items ?? []).filter(s => s && s.trim()).map(s => s.trim());
  const expectedItemCount = Math.min(contract.maxItems, items.length);
  let placedItemCount = 0;

  for (let i = 0; i < expectedItemCount; i++) {
    const text   = items[i];
    const zoneId = contract.itemZones[i];
    if (!zoneId) break;
    if (!availableZoneIds.has(zoneId)) continue;
    if (!placeOnce(zoneId, text)) continue;
    slots.push({
      zoneId,
      role:  "item",
      kind:  contract.itemKind,
      title: text,
      index: placedItemCount + 1,
    });
    placedItemCount += 1;
  }

  // Flag the list-compression failure:
  //   items arrived from OpenAI (>= 2) but <2 of them made it to
  //   distinct zones. That means the canvas has the content but the
  //   template visually renders one block.
  const compressed =
    items.length >= 2 && placedItemCount < Math.min(2, items.length);

  // Underfilled = required roles missing OR fewer placed items than
  // the contract's minimum. List-style templates that shipped zero
  // items are the primary hit.
  const underfilled =
    missingRequired.length > 0 ||
    (contract.minItems > 0 && placedItemCount < contract.minItems);

  const report: MappingCoverageReport = {
    templateType,
    slots,
    placedRoles,
    missingRequired,
    expectedItemCount,
    placedItemCount,
    compressed,
    underfilled,
    distinctZoneCount: usedZones.size,
  };

  return { slots, textMap, report };
}

// ── Role → content extraction ───────────────────────────────────────────────

function extractRoleText(content: StructuredContent, role: ContentRole): string {
  switch (role) {
    case "headline":    return content.headline;
    case "subhead":     return content.subhead;
    case "cta":         return content.cta;
    case "badge":       return content.badge ?? "";
    case "eyebrow":     return content.eyebrow ?? "";
    case "attribution": {
      const a = content.attribution;
      if (!a) return "";
      // Quote attributions read better with an em-dash prefix when the
      // speaker name doesn't already start with one.
      return a.startsWith("—") || a.startsWith("-") ? a : `— ${a}`;
    }
    case "supporting":  return content.supporting ?? content.subhead ?? "";
    case "title":       return content.eyebrow ?? "";
    case "name":        return content.attribution ?? "";
    case "item":        return ""; // items handled separately
    default:            return "";
  }
}

// ── Audit helper ────────────────────────────────────────────────────────────

export function describeMappingReport(r: MappingCoverageReport): string {
  const parts: string[] = [];
  parts.push(`type=${r.templateType}`);
  parts.push(`slots=${r.slots.length}`);
  parts.push(`items=${r.placedItemCount}/${r.expectedItemCount}`);
  parts.push(`zones=${r.distinctZoneCount}`);
  parts.push(`placed=[${r.placedRoles.join(",")}]`);
  if (r.missingRequired.length) parts.push(`missing=[${r.missingRequired.join(",")}]`);
  if (r.compressed)  parts.push("compressed");
  if (r.underfilled) parts.push("underfilled");
  return parts.join(" ");
}

/** Minimum slots the rejection gate expects for any template.
 *  Headline + at least one supporting element = 2. */
export const MIN_COMPONENT_SLOTS = 2;
