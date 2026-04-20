// src/engines/content/content-structure.ts
//
// CONTENT-AWARE STRUCTURE ANALYZER
// ─────────────────────────────────────────────────────────────────────────────
// Designs built from a single body paragraph feel like flat text cards —
// even when the underlying brief is clearly a list of tips, steps, or
// bullets. This module reads the populated text, detects list-like
// structure, and splits it into discrete items so the renderer can emit
// real component rows (checklist / tips / steps / content cards) instead
// of one giant paragraph.
//
// Responsibilities:
//
//   1. `analyzeContentStructure(text)`
//      Classifies a raw text blob as prose / list / checklist / steps /
//      tips / quote and extracts the items when it's a list. Works on
//      numbered sequences ("1. X 2. Y"), bullet glyphs (•, -, *),
//      explicit markers (Tip 1:, Step 2:), newline-separated lines, and
//      short semicolon-separated phrases.
//
//   2. `restructureTextMap(textMap, zoneIds, templateType)`
//      For list-oriented template types (checklist / tips / step_by_step
//      / list_based / educational), detects list content in body /
//      subhead / tagline and redistributes the extracted items across
//      bullet_1 / bullet_2 / bullet_3 zones that the layout already
//      exposes. Clears the source zone when the list was its entire
//      contents; otherwise leaves the source text alone. Returns the
//      updated map plus an audit trail.
//
//   3. `analyzeContentCoverage(textMap, templateType)`
//      Coverage report the rejection rule consumes: how many list items
//      the active template type expects vs. how many distinct populated
//      bullets (or structured zones) actually exist.
//
// The restructurer is deliberately conservative: it never invents
// content, never moves text across template types that don't imply
// lists (quote, promotional, minimal), and never overwrites a bullet
// zone that the composer already populated with its own text.

import type { TemplateType } from "../templates/template-types";

// ── Structure kinds ──────────────────────────────────────────────────────────

export type ContentStructureKind =
  | "prose"
  | "list"
  | "checklist"
  | "steps"
  | "tips"
  | "quote"
  | "informational";

export interface ContentStructure {
  kind:    ContentStructureKind;
  items:   string[];
  /** Raw text the analyzer was given (for audit / fallback). */
  source:  string;
  /** Confidence the detected structure actually applies (0..1). */
  confidence: number;
}

// ── Detector ─────────────────────────────────────────────────────────────────

/** Minimum characters per item — shorter fragments are treated as noise. */
const MIN_ITEM_LEN = 3;
/** Maximum items the analyzer will ever emit. Layouts only expose 3
 *  bullet zones; we keep the analyzer aligned with that ceiling. */
const MAX_ITEMS = 6;

const NUMBERED_MARKER = /(^|\s)(\d{1,2})[.)\]]\s+/g;
const STEP_MARKER     = /\b(?:step)\s*#?\s*\d+\s*[:.\-–]\s*/gi;
const TIP_MARKER      = /\b(?:tip|pro tip|hint)\s*#?\s*\d*\s*[:.\-–]\s*/gi;
const BULLET_GLYPH    = /\s*[•·●◦▪▫■□▶►→]\s*/g;
const DASH_LEADER     = /(^|\s)[-*]\s+/g;

function cleanItem(s: string): string {
  return s
    .replace(/^[\s\-•·●◦▪▫■□▶►→*]+/, "")
    .replace(/[\s,;]+$/, "")
    .trim();
}

function splitByRegex(text: string, re: RegExp): string[] {
  // Replace markers with a unique sentinel, then split on it.
  const sentinel = "\u0001";
  return text.replace(re, sentinel).split(sentinel).map(cleanItem).filter(s => s.length >= MIN_ITEM_LEN);
}

function containsMarker(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

function classifyByMarkers(text: string): ContentStructureKind {
  if (containsMarker(text, /\b(checklist|to-?do|must-have|required|essential)\b/i)) return "checklist";
  if (containsMarker(text, STEP_MARKER) || containsMarker(text, /\b(first|second|third|next|finally|then)\b/i)) return "steps";
  if (containsMarker(text, TIP_MARKER) || containsMarker(text, /\b(tips?|advice|best practice|pro tip)\b/i)) return "tips";
  if (/^\s*["“”].+["“”]\s*$/.test(text) || /\s[—–]\s*(?:[A-Z][a-z]+\s?){1,3}\s*$/.test(text)) return "quote";
  return "list";
}

export function analyzeContentStructure(text: string): ContentStructure {
  const source = (text ?? "").trim();
  if (!source) return { kind: "prose", items: [], source, confidence: 0 };

  // Numbered list detection.
  if (containsMarker(source, NUMBERED_MARKER) && (source.match(NUMBERED_MARKER)?.length ?? 0) >= 2) {
    const items = splitByRegex(source, NUMBERED_MARKER).slice(0, MAX_ITEMS);
    if (items.length >= 2) {
      return { kind: "steps", items, source, confidence: 0.9 };
    }
  }

  // Step/tip marker detection.
  if (containsMarker(source, STEP_MARKER) && (source.match(STEP_MARKER)?.length ?? 0) >= 2) {
    const items = splitByRegex(source, STEP_MARKER).slice(0, MAX_ITEMS);
    if (items.length >= 2) return { kind: "steps", items, source, confidence: 0.9 };
  }
  if (containsMarker(source, TIP_MARKER) && (source.match(TIP_MARKER)?.length ?? 0) >= 2) {
    const items = splitByRegex(source, TIP_MARKER).slice(0, MAX_ITEMS);
    if (items.length >= 2) return { kind: "tips", items, source, confidence: 0.9 };
  }

  // Bullet-glyph detection.
  if (containsMarker(source, BULLET_GLYPH) && (source.match(BULLET_GLYPH)?.length ?? 0) >= 2) {
    const items = splitByRegex(source, BULLET_GLYPH).slice(0, MAX_ITEMS);
    if (items.length >= 2) {
      const kind = classifyByMarkers(source);
      return { kind, items, source, confidence: 0.85 };
    }
  }

  // Dash-leader detection (line-starting "- " or "* ").
  if ((source.match(DASH_LEADER)?.length ?? 0) >= 2) {
    const items = splitByRegex(source, DASH_LEADER).slice(0, MAX_ITEMS);
    if (items.length >= 2) {
      const kind = classifyByMarkers(source);
      return { kind, items, source, confidence: 0.8 };
    }
  }

  // Newline-separated list (2+ non-empty lines).
  const lines = source.split(/\r?\n/).map(cleanItem).filter(s => s.length >= MIN_ITEM_LEN);
  if (lines.length >= 2 && lines.length <= MAX_ITEMS) {
    const kind = classifyByMarkers(source);
    return { kind, items: lines, source, confidence: 0.7 };
  }

  // Semicolon-separated short phrases (each under 70 chars).
  if (source.includes(";")) {
    const parts = source.split(/\s*;\s*/).map(cleanItem).filter(s => s.length >= MIN_ITEM_LEN && s.length <= 70);
    if (parts.length >= 2 && parts.length <= MAX_ITEMS) {
      return { kind: "list", items: parts, source, confidence: 0.65 };
    }
  }

  // Inline "Tip:" or "Step:" at sentence starts.
  if (/\bTip\s*[:.-]|\bStep\s*[:.-]/i.test(source)) {
    const split = source.split(/(?=\b(?:Tip|Step)\s*[:.-])/i)
      .map(cleanItem)
      .filter(s => s.length >= MIN_ITEM_LEN);
    if (split.length >= 2) {
      const kind = /step/i.test(source) ? "steps" : "tips";
      return { kind, items: split.slice(0, MAX_ITEMS), source, confidence: 0.72 };
    }
  }

  return { kind: "prose", items: [], source, confidence: 0 };
}

// ── Template-type alignment ──────────────────────────────────────────────────

/** Template types that expect multiple structured items — triggers the
 *  restructurer to redistribute body/subhead list content into bullets. */
const LIST_STYLE_TEMPLATES: ReadonlySet<TemplateType> = new Set<TemplateType>([
  "checklist", "tips", "step_by_step", "list_based", "educational",
]);

/** Minimum number of populated bullet zones a list-style template must
 *  ship. The rejection rule drops outputs below this floor. */
export const MIN_LIST_ITEMS = 2;

export function expectsStructuredList(templateType: TemplateType | undefined): boolean {
  return !!templateType && LIST_STYLE_TEMPLATES.has(templateType);
}

/** Template-type specific suggested content kind. The restructurer uses
 *  this when the text analyzer is ambiguous, so a `checklist` template
 *  with a numbered body still classifies as "checklist" for downstream
 *  component assignment. */
function hintedKindForType(templateType: TemplateType | undefined): ContentStructureKind {
  switch (templateType) {
    case "checklist":    return "checklist";
    case "tips":         return "tips";
    case "step_by_step": return "steps";
    case "list_based":   return "list";
    case "educational":  return "informational";
    case "quote":        return "quote";
    default:             return "prose";
  }
}

// ── Text-map restructurer ────────────────────────────────────────────────────

export interface RestructureAction {
  kind:    "split" | "clear" | "skip";
  source:  string;
  targets: string[];
  items:   string[];
  reason:  string;
}

export interface RestructureResult {
  textMap:        Map<string, string>;
  actions:        RestructureAction[];
  detectedKind:   ContentStructureKind;
  producedItems:  number;
}

/** Zones we pull list content out of, in priority order. */
const SOURCE_CANDIDATES = ["body", "subhead", "tagline", "section_header"] as const;
/** Zones we distribute items INTO, in order. */
const TARGET_BULLETS   = ["bullet_1", "bullet_2", "bullet_3"] as const;

export function restructureTextMap(
  textMap:      Map<string, string>,
  availableZoneIds: ReadonlySet<string>,
  templateType: TemplateType | undefined,
): RestructureResult {
  const actions: RestructureAction[] = [];

  // Only list-style templates get their body restructured.
  if (!expectsStructuredList(templateType)) {
    return {
      textMap,
      actions: [{ kind: "skip", source: "-", targets: [], items: [], reason: `template_${templateType ?? "none"}_not_list_style` }],
      detectedKind: hintedKindForType(templateType),
      producedItems: 0,
    };
  }

  // Determine which target bullet zones are available AND currently empty.
  const freeTargets: string[] = [];
  for (const t of TARGET_BULLETS) {
    if (!availableZoneIds.has(t)) continue;
    const existing = (textMap.get(t) ?? "").trim();
    if (existing.length === 0) freeTargets.push(t);
  }

  // If every bullet zone is already populated, the composer already did
  // the work; skip restructuring.
  const populatedBullets = TARGET_BULLETS.filter(t => (textMap.get(t) ?? "").trim().length > 0);
  if (freeTargets.length === 0 && populatedBullets.length >= MIN_LIST_ITEMS) {
    return {
      textMap,
      actions: [{ kind: "skip", source: "-", targets: [], items: [], reason: "bullets_already_populated" }],
      detectedKind: hintedKindForType(templateType),
      producedItems: populatedBullets.length,
    };
  }

  // Look for list content in the source candidates.
  let bestSource: string | null = null;
  let bestStructure: ContentStructure | null = null;
  for (const src of SOURCE_CANDIDATES) {
    const txt = (textMap.get(src) ?? "").trim();
    if (!txt) continue;
    const structure = analyzeContentStructure(txt);
    if (structure.items.length >= MIN_LIST_ITEMS && structure.kind !== "prose" && structure.kind !== "quote") {
      if (!bestStructure || structure.items.length > bestStructure.items.length) {
        bestSource    = src;
        bestStructure = structure;
      }
    }
  }

  if (!bestSource || !bestStructure) {
    return {
      textMap,
      actions: [{ kind: "skip", source: "-", targets: [], items: [], reason: "no_list_content_detected" }],
      detectedKind: populatedBullets.length >= MIN_LIST_ITEMS ? hintedKindForType(templateType) : "prose",
      producedItems: populatedBullets.length,
    };
  }

  // Distribute extracted items across the free bullet targets.
  const updated = new Map(textMap);
  const toAssign = bestStructure.items.slice(0, freeTargets.length);
  for (let i = 0; i < toAssign.length; i++) {
    updated.set(freeTargets[i], toAssign[i]);
  }

  // Decide whether to clear the source zone. If the full source text is
  // essentially *only* the list items (concatenated), clear it. Otherwise
  // leave it as an intro line.
  const joined = bestStructure.items.join(" ").toLowerCase().replace(/\s+/g, " ");
  const norm   = bestStructure.source.toLowerCase().replace(/[\d.)•·●◦▪▫■□▶►→\-*]/g, " ").replace(/\s+/g, " ").trim();
  const sourceIsOnlyList = norm.length <= joined.length * 1.4;
  if (sourceIsOnlyList) {
    updated.set(bestSource, "");
    actions.push({ kind: "clear", source: bestSource, targets: freeTargets.slice(0, toAssign.length), items: toAssign, reason: "source_was_list_only" });
  } else {
    actions.push({ kind: "split", source: bestSource, targets: freeTargets.slice(0, toAssign.length), items: toAssign, reason: "source_retained_as_lead" });
  }

  // Override the detected kind with the template-type hint so downstream
  // components match the template (checklist templates always style their
  // items as checklist rows even if the text was detected as generic list).
  const detectedKind: ContentStructureKind = (() => {
    const hint = hintedKindForType(templateType);
    return hint === "prose" ? bestStructure.kind : hint;
  })();

  return {
    textMap: updated,
    actions,
    detectedKind,
    producedItems: populatedBullets.length + toAssign.length,
  };
}

// ── Coverage report ──────────────────────────────────────────────────────────

export interface ContentCoverageReport {
  /** Detected content structure kind. */
  kind:              ContentStructureKind;
  /** Bullet-zone items populated after restructuring. */
  populatedItems:    number;
  /** Minimum items required for list-style templates. */
  required:          number;
  /** True iff this template type does not require structured items OR
   *  enough bullet zones carry text. */
  satisfiesMinimum:  boolean;
  /** Summary of what the restructurer did. */
  actionsSummary:    string;
}

export function analyzeContentCoverage(
  textMap:      ReadonlyMap<string, string>,
  templateType: TemplateType | undefined,
  actions:      RestructureAction[],
): ContentCoverageReport {
  const populatedItems = TARGET_BULLETS.filter(t => (textMap.get(t) ?? "").trim().length > 0).length;
  const required       = expectsStructuredList(templateType) ? MIN_LIST_ITEMS : 0;
  const satisfies      = populatedItems >= required;
  const summary        = actions.map(a => `${a.kind}:${a.source}→${a.targets.join("/") || "-"}`).join("|");
  return {
    kind:            hintedKindForType(templateType),
    populatedItems,
    required,
    satisfiesMinimum: satisfies,
    actionsSummary:  summary,
  };
}

export function contentCoverageSummary(rep: ContentCoverageReport): string {
  return `${rep.kind} items=${rep.populatedItems}/${rep.required} ok=${rep.satisfiesMinimum}`;
}
