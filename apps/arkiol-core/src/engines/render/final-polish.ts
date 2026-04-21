// src/engines/render/final-polish.ts
//
// Step 62: Final refinement pass.
//
// Sits at the very end of the render pipeline — after build-refinement
// (Step 24), output-polish, style-enforcer, typography-hierarchy (Step
// 60), and color-harmony (Step 61) have all spoken. Two responsibilities:
//
//   1. Net-new late-stage auto-fixes.  The earlier chain handles the
//      big-ticket repairs (contrast, overflow, hierarchy, clutter) and
//      value normalisations (font-size snap, hex-case, CTA padding).
//      What it DOESN'T do:
//
//        • Expand 3-digit hex tokens (#fff) into the 6-digit form so
//          every downstream consumer sees a single representation.
//        • Tidy `overlayOpacity` — strip invisible (<0.02) overlays and
//          drop redundant fully-opaque (>0.98) ones so the renderer
//          doesn't emit a no-op rect; round the rest to 2 decimals.
//        • Drop text zones whose final text is empty / whitespace so
//          the SVG doesn't carry orphan `<text>` elements that widen
//          the DOM and confuse downstream selection heuristics.
//        • Snap text weights to the nearest standard CSS weight —
//          output-polish handles the common path, but the pass is
//          idempotent-safe and catches anything that slipped through
//          post-polish edits (e.g. typography hierarchy resize).
//
//   2. Aggregate polish verdict.  Parses the full accumulated
//      violations array, classifies each entry by severity tag
//      (`[error]`, `[warning]`, the marketplace-gate `REJECTED`
//      marker), computes a polish score, and returns one of:
//
//        finished   — zero errors, polish score ≥ 0.80. Ship it.
//        rough      — ≤1 error, polish score ≥ 0.50. Shippable but
//                      the template still reads a little unfinished;
//                      surfaces a soft-severity `finish_pass:rough`
//                      warning so the marketplace gate can down-weight
//                      it relative to a clean candidate.
//        unfinished — otherwise. Surfaces a hard-severity
//                      `finish_pass:unfinished[error]` violation so
//                      the rejection-rules layer drops the candidate.
//
// Pure. Idempotent: re-running on an already-polished result produces
// zero actions and the same verdict.

import type { SvgContent } from "./svg-builder-ultimate";

// ── Types ────────────────────────────────────────────────────────────────────

export type FinishAction =
  | { fix: "expand_short_hex"; field: string; before: string; after: string }
  | { fix: "trim_opacity";     field: string; before: number; after: "dropped" }
  | { fix: "round_opacity";    field: string; before: number; after: number }
  | { fix: "strip_empty_text"; zoneId: string }
  | { fix: "snap_weight";      zoneId: string; before: number; after: number };

export type FinishVerdict = "finished" | "rough" | "unfinished";

export interface FinishVerdictSummary {
  verdict:     FinishVerdict;
  polishScore: number;                         // 0..1
  errors:      number;
  warnings:    number;
  rejections:  number;                         // count of `REJECTED` markers
  bySource:    Record<string, { errors: number; warnings: number }>;
}

export interface FinishPassInput {
  content:               SvgContent;
  accumulatedViolations: readonly string[];
}

export interface FinishPassResult {
  content:          SvgContent;
  actions:          FinishAction[];
  summary:          FinishVerdictSummary;
  /** Violation string the pipeline should push when verdict !== "finished". */
  verdictViolation: string | undefined;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Score at/above this with zero errors → "finished". */
export const FINISH_SCORE_FINISHED = 0.80;

/** Score at/above this (with ≤ FINISH_ROUGH_MAX_ERRORS errors) → "rough". */
export const FINISH_SCORE_ROUGH = 0.50;

/** Per-error weight applied to polishScore. */
export const FINISH_ERROR_WEIGHT = 0.25;

/** Per-warning weight applied to polishScore. */
export const FINISH_WARNING_WEIGHT = 0.05;

/** Max errors tolerated when classifying "rough". */
export const FINISH_ROUGH_MAX_ERRORS = 1;

/** Opacity values below this count as invisible — dropped. */
export const FINISH_OPACITY_MIN = 0.02;

/** Opacity values above this count as fully opaque — dropped (no-op rect). */
export const FINISH_OPACITY_MAX = 0.98;

// ── Severity parsing ─────────────────────────────────────────────────────────

interface ParsedViolation {
  source:   string;
  severity: "error" | "warning" | "info";
}

/**
 * Parse a pipeline violation string.  The pipeline tags severity two
 * ways: validator blocks embed `[error]` / `[warning]` after the rule
 * name, and the marketplace gate uses a `REJECTED`/`APPROVED` marker.
 * Everything else (refinement actions, polish actions, hierarchy/style
 * applications) is treated as informational.
 */
function parseViolation(raw: string): ParsedViolation {
  const colonIdx = raw.indexOf(":");
  const source   = colonIdx > 0 ? raw.slice(0, colonIdx) : "unknown";
  let severity: ParsedViolation["severity"] = "info";
  if (raw.includes("[error]"))            severity = "error";
  else if (raw.includes("[warning]"))     severity = "warning";
  else if (raw.includes("REJECTED"))      severity = "error";
  return { source, severity };
}

// ── Auto-fix helpers ─────────────────────────────────────────────────────────

/** #rgb → #rrggbb (lowercase). Returns the input unchanged for 6-digit or non-hex. */
export function expandShortHex(hex: string | undefined): string | undefined {
  if (!hex || typeof hex !== "string") return hex;
  const m = hex.match(/^#([0-9a-fA-F]{3})$/);
  if (!m) return hex;
  const [r, g, b] = [m[1][0], m[1][1], m[1][2]];
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

const STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Nearest multiple-of-100 CSS weight. Ties round up. */
export function nearestStandardWeight(w: number): number {
  if (!Number.isFinite(w)) return 400;
  let best = 400, bestDist = Infinity;
  for (const sw of STANDARD_WEIGHTS) {
    const d = Math.abs(w - sw);
    if (d < bestDist || (d === bestDist && sw > best)) {
      best = sw; bestDist = d;
    }
  }
  return best;
}

type OpacityTidy =
  | { kind: "unchanged"; value: number | undefined }
  | { kind: "dropped";   before: number }
  | { kind: "rounded";   before: number; after: number };

function tidyOpacity(v: number | undefined): OpacityTidy {
  if (v === undefined)       return { kind: "unchanged", value: undefined };
  if (!Number.isFinite(v))   return { kind: "dropped",   before: v };
  if (v < FINISH_OPACITY_MIN) return { kind: "dropped",  before: v };
  if (v > FINISH_OPACITY_MAX) return { kind: "dropped",  before: v };
  const rounded = Math.round(v * 100) / 100;
  if (rounded === v)         return { kind: "unchanged", value: v };
  return { kind: "rounded", before: v, after: rounded };
}

// ── Verdict scorer ───────────────────────────────────────────────────────────

/**
 * Roll up an array of pipeline violation strings into a verdict.
 * Exposed separately so downstream tools (e.g., retry schedulers) can
 * score a candidate without re-running the finish pass.
 */
export function summarizeViolations(
  violations: readonly string[],
): FinishVerdictSummary {
  let errors = 0, warnings = 0, rejections = 0;
  const bySource: Record<string, { errors: number; warnings: number }> = {};

  for (const v of violations) {
    const parsed = parseViolation(v);
    const bucket = bySource[parsed.source] ?? (bySource[parsed.source] = { errors: 0, warnings: 0 });
    if (parsed.severity === "error")        { errors++;   bucket.errors++; }
    else if (parsed.severity === "warning") { warnings++; bucket.warnings++; }
    if (v.includes("REJECTED"))             { rejections++; }
  }

  const rawScore = 1 - errors * FINISH_ERROR_WEIGHT - warnings * FINISH_WARNING_WEIGHT;
  const polishScore = Math.max(0, Math.min(1, rawScore));

  let verdict: FinishVerdict;
  if (errors === 0 && polishScore >= FINISH_SCORE_FINISHED) {
    verdict = "finished";
  } else if (errors <= FINISH_ROUGH_MAX_ERRORS && polishScore >= FINISH_SCORE_ROUGH) {
    verdict = "rough";
  } else {
    verdict = "unfinished";
  }

  return { verdict, polishScore, errors, warnings, rejections, bySource };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run the final refinement pass. Returns a new SvgContent with
 * late-stage auto-fixes applied, a list of actions for the audit log,
 * and a verdict roll-up over the accumulated violations.
 */
export function runFinishPass(input: FinishPassInput): FinishPassResult {
  const content = input.content;
  const actions: FinishAction[] = [];

  let next: SvgContent = content;
  let touched = false;
  const ensureCopy = () => { if (!touched) { next = { ...content }; touched = true; } };

  // 1. backgroundColor hex expansion
  if (content.backgroundColor) {
    const e = expandShortHex(content.backgroundColor);
    if (e && e !== content.backgroundColor) {
      ensureCopy();
      actions.push({ fix: "expand_short_hex", field: "backgroundColor", before: content.backgroundColor, after: e });
      next.backgroundColor = e;
    }
  }

  // 2. backgroundGradient colors
  if (content.backgroundGradient && Array.isArray(content.backgroundGradient.colors)) {
    const before = content.backgroundGradient.colors;
    const expanded = before.map(c => expandShortHex(c) ?? c);
    const changed  = expanded.some((c, i) => c !== before[i]);
    if (changed) {
      ensureCopy();
      actions.push({
        fix:    "expand_short_hex",
        field:  "backgroundGradient.colors",
        before: before.join(","),
        after:  expanded.join(","),
      });
      next.backgroundGradient = { ...content.backgroundGradient, colors: expanded };
    }
  }

  // 3. textContents — strip empty zones, expand hex, snap weight
  let textChanged = false;
  const cleanedText: SvgContent["textContents"] = [];
  for (const tc of content.textContents) {
    if (!tc.text || !tc.text.trim()) {
      actions.push({ fix: "strip_empty_text", zoneId: tc.zoneId });
      textChanged = true;
      continue;
    }
    let zoneChanged = false;
    let color       = tc.color;
    let weight      = tc.weight;

    const ec = expandShortHex(tc.color);
    if (ec && ec !== tc.color) {
      actions.push({ fix: "expand_short_hex", field: `textContents.${tc.zoneId}.color`, before: tc.color, after: ec });
      color = ec;
      zoneChanged = true;
    }

    const sw = nearestStandardWeight(tc.weight);
    if (sw !== tc.weight) {
      actions.push({ fix: "snap_weight", zoneId: tc.zoneId, before: tc.weight, after: sw });
      weight = sw;
      zoneChanged = true;
    }

    if (zoneChanged) { textChanged = true; cleanedText.push({ ...tc, color, weight }); }
    else             { cleanedText.push(tc); }
  }
  if (textChanged) { ensureCopy(); next.textContents = cleanedText; }

  // 4. ctaStyle hex expansion
  if (content.ctaStyle) {
    const ebg = expandShortHex(content.ctaStyle.backgroundColor);
    const etx = expandShortHex(content.ctaStyle.textColor);
    const bgChanged = !!ebg && ebg !== content.ctaStyle.backgroundColor;
    const txChanged = !!etx && etx !== content.ctaStyle.textColor;
    if (bgChanged || txChanged) {
      ensureCopy();
      actions.push({
        fix:    "expand_short_hex",
        field:  "ctaStyle",
        before: `${content.ctaStyle.backgroundColor}/${content.ctaStyle.textColor}`,
        after:  `${ebg ?? content.ctaStyle.backgroundColor}/${etx ?? content.ctaStyle.textColor}`,
      });
      next.ctaStyle = {
        ...content.ctaStyle,
        backgroundColor: ebg ?? content.ctaStyle.backgroundColor,
        textColor:       etx ?? content.ctaStyle.textColor,
      };
    }
  }

  // 5. accentShape hex expansion
  if (content.accentShape) {
    const ac = expandShortHex(content.accentShape.color);
    if (ac && ac !== content.accentShape.color) {
      ensureCopy();
      actions.push({
        fix:    "expand_short_hex",
        field:  "accentShape.color",
        before: content.accentShape.color,
        after:  ac,
      });
      next.accentShape = { ...content.accentShape, color: ac };
    }
  }

  // 6. overlayOpacity tidy
  const opTidy = tidyOpacity(content.overlayOpacity);
  if (opTidy.kind !== "unchanged") {
    ensureCopy();
    if (opTidy.kind === "dropped") {
      actions.push({ fix: "trim_opacity",  field: "overlayOpacity", before: opTidy.before, after: "dropped" });
      next.overlayOpacity = undefined;
    } else {
      actions.push({ fix: "round_opacity", field: "overlayOpacity", before: opTidy.before, after: opTidy.after });
      next.overlayOpacity = opTidy.after;
    }
  }

  // ── Verdict roll-up ───────────────────────────────────────────────────────
  const summary = summarizeViolations(input.accumulatedViolations);

  let verdictViolation: string | undefined;
  if (summary.verdict === "unfinished") {
    verdictViolation =
      `finish_pass:unfinished[error]: polish score ${summary.polishScore.toFixed(2)} ` +
      `with ${summary.errors} error(s) and ${summary.warnings} warning(s) — ` +
      `template reads as unfinished and must be rejected.`;
  } else if (summary.verdict === "rough") {
    verdictViolation =
      `finish_pass:rough[warning]: polish score ${summary.polishScore.toFixed(2)} ` +
      `with ${summary.errors} error(s) and ${summary.warnings} warning(s) — ` +
      `template is shippable but reads slightly unfinished.`;
  }

  // Attach the verdict summary to content so downstream consumers
  // (rejection rules, gallery ranker) can make decisions without
  // re-running the rollup. Mirrors how `_composition` and
  // `_styleConsistency` surface their verdicts.
  ensureCopy();
  (next as any)._finishVerdict = summary;

  return { content: next, actions, summary, verdictViolation };
}
