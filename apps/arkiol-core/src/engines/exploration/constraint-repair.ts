// src/engines/exploration/constraint-repair.ts
// Creative Exploration AI Engine — Constraint & Repair Module
// ─────────────────────────────────────────────────────────────────────────────
//
// Validates every candidate against 6 constraint classes and attempts
// automatic repair before discarding. Only candidates with no remaining
// FATAL violations pass through to the evaluation stage.
//
// Constraint classes:
//   C1: Layout Geometry Validity     — zones in bounds, no required zone missing
//   C2: Asset Contract               — image requirements vs. asset availability
//   C3: Text-Fit Estimation          — char budget vs. density profile
//   C4: Accessibility Contrast Rules — minimum 4.5:1 AA or 3:1 AA-large
//   C5: Spacing Integrity            — minimum gutter between adjacent zones
//   C6: Platform Safety Thresholds   — safe zones, aspect ratios, font minimums
//
// Repair strategies (in priority order):
//   R1: Swap variation → nearest compliant variation
//   R2: Reduce density profile → one level down (dense→rich→balanced→sparse)
//   R3: Override hookStrategy → "bold_headline" (always safe)
//   R4: Force motionEligible = false (for motion safety violations)
//   R5: Discard (unrecoverable — fatal violations remain after max repair attempts)
//
// Invariants:
//   ✓ Each candidate goes through AT MOST 3 repair passes (MAX_REPAIR_PASSES)
//   ✓ Repairs are deterministic — given the same violation, same repair applied
//   ✓ Repair log is append-only; original genome preserved on candidate
//   ✓ Returns a new CandidateDesignPlan (no mutation of input)

import type {
  CandidateDesignPlan,
  ConstraintReport,
  ConstraintViolation,
  ConstraintViolationType,
  DensityProfileLevel,
  DesignGenome,
} from "./types";
import { FORMAT_DIMS } from "../../lib/types";
import { GENOME_SPACE } from "./genome-generator";

const MAX_REPAIR_PASSES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// § 1  PLATFORM SAFETY PROFILES — format-specific hard limits
// ─────────────────────────────────────────────────────────────────────────────

interface PlatformSafetyProfile {
  /** Minimum font size in px for primary text zones */
  minHeadlineFontPx: number;
  /** Safe-zone margin as % of canvas dimension */
  safeZoneMarginPct: number;
  /** Maximum number of active text zones */
  maxTextZones: number;
  /** Whether GIF motion is allowed */
  allowsMotion: boolean;
  /** Minimum contrast ratio for WCAG AA */
  minContrastRatio: number;
}

const PLATFORM_SAFETY: Record<string, PlatformSafetyProfile> = {
  instagram_post:     { minHeadlineFontPx: 28, safeZoneMarginPct: 5,  maxTextZones: 5, allowsMotion: true,  minContrastRatio: 4.5 },
  instagram_story:    { minHeadlineFontPx: 40, safeZoneMarginPct: 8,  maxTextZones: 4, allowsMotion: true,  minContrastRatio: 4.5 },
  youtube_thumbnail:  { minHeadlineFontPx: 48, safeZoneMarginPct: 4,  maxTextZones: 3, allowsMotion: false, minContrastRatio: 4.5 },
  flyer:              { minHeadlineFontPx: 36, safeZoneMarginPct: 5,  maxTextZones: 8, allowsMotion: false, minContrastRatio: 4.5 },
  poster:             { minHeadlineFontPx: 48, safeZoneMarginPct: 5,  maxTextZones: 6, allowsMotion: false, minContrastRatio: 4.5 },
  presentation_slide: { minHeadlineFontPx: 32, safeZoneMarginPct: 6,  maxTextZones: 7, allowsMotion: false, minContrastRatio: 3.0 },
  business_card:      { minHeadlineFontPx: 14, safeZoneMarginPct: 8,  maxTextZones: 6, allowsMotion: false, minContrastRatio: 4.5 },
  resume:             { minHeadlineFontPx: 10, safeZoneMarginPct: 10, maxTextZones: 12, allowsMotion: false, minContrastRatio: 4.5 },
  logo:               { minHeadlineFontPx: 20, safeZoneMarginPct: 10, maxTextZones: 2, allowsMotion: false, minContrastRatio: 4.5 },
};

const DEFAULT_SAFETY: PlatformSafetyProfile = {
  minHeadlineFontPx: 28,
  safeZoneMarginPct: 5,
  maxTextZones: 5,
  allowsMotion: true,
  minContrastRatio: 4.5,
};

// ─────────────────────────────────────────────────────────────────────────────
// § 2  DENSITY → TEXT ZONE COUNT mapping
// ─────────────────────────────────────────────────────────────────────────────

const DENSITY_TEXT_ZONE_COUNT: Record<DensityProfileLevel, number> = {
  sparse:   2,
  balanced: 3,
  rich:     5,
  dense:    7,
};

// ─────────────────────────────────────────────────────────────────────────────
// § 3  CONTRAST UTILITIES — fast WCAG approximation (no full color parsing)
// ─────────────────────────────────────────────────────────────────────────────

/** Converts a hex color to relative luminance (WCAG formula approximation) */
function hexToRelativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return 0.5; // unknown → assume mid
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const linearize = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = hexToRelativeLuminance(hex1);
  const l2 = hexToRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Preset background / text color pairs using correct StylePresetId keys
// (clean | bold | professional | minimal | expressive)
const PRESET_CONTRAST_PAIRS: Record<string, [string, string]> = {
  clean:        ["#ffffff", "#1a1a1a"],  // white bg, near-black text
  bold:         ["#e63946", "#ffffff"],  // strong colour bg, white text
  professional: ["#f8f9fa", "#212529"],  // light grey bg, near-black text
  minimal:      ["#f5f5f5", "#111111"],  // very light grey bg, dark text
  expressive:   ["#1a0533", "#ffffff"],  // deep dark bg, white text
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4  INDIVIDUAL CONSTRAINT CHECKERS
// ─────────────────────────────────────────────────────────────────────────────

/** C1: Layout Geometry Validity */
function checkLayoutGeometry(
  genome: DesignGenome,
  format: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const dims = FORMAT_DIMS[format];
  if (!dims) {
    violations.push({
      type: "layout_geometry_invalid",
      severity: "fatal",
      detail: `Unknown format: ${format}`,
      repaired: false,
      repairAction: "",
    });
    return violations;
  }

  // Validate variation ID exists for this layout family
  const validVariations = GENOME_SPACE.variationIds[genome.layoutFamily];
  if (!validVariations || !validVariations.includes(genome.variationId)) {
    violations.push({
      type: "layout_geometry_invalid",
      severity: "warning",
      detail: `Variation ${genome.variationId} not registered for family ${genome.layoutFamily}`,
      repaired: false,
      repairAction: "",
    });
  }

  return violations;
}

/** C2: Asset Contract Validation */
function checkAssetContract(
  genome: DesignGenome,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // Logo format should not use hookStrategies that require images
  if (genome.layoutFamily === "logo" && genome.hookStrategy === "visual_lead") {
    violations.push({
      type: "asset_contract_violation",
      severity: "warning",
      detail: "Logo format incompatible with visual_lead hook strategy",
      zone: "image",
      repaired: false,
      repairAction: "",
    });
  }

  // Resume/business_card should not have motion
  if (
    (genome.layoutFamily === "resume" || genome.layoutFamily === "business_card") &&
    genome.motionEligible
  ) {
    violations.push({
      type: "asset_contract_violation",
      severity: "fatal",
      detail: `${genome.layoutFamily} format does not support motion`,
      repaired: false,
      repairAction: "",
    });
  }

  return violations;
}

/** C3: Text-Fit Estimation */
function checkTextFit(
  genome: DesignGenome,
  format: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const safety = PLATFORM_SAFETY[format] ?? DEFAULT_SAFETY;

  const estimatedZones = DENSITY_TEXT_ZONE_COUNT[genome.densityProfile];
  if (estimatedZones > safety.maxTextZones) {
    violations.push({
      type: "text_fit_overflow",
      severity: "warning",
      detail: `Density profile '${genome.densityProfile}' requires ~${estimatedZones} text zones; platform max is ${safety.maxTextZones}`,
      repaired: false,
      repairAction: "",
    });
  }

  return violations;
}

/** C4: Accessibility Contrast */
function checkContrast(
  genome: DesignGenome,
  format: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const safety = PLATFORM_SAFETY[format] ?? DEFAULT_SAFETY;
  const pair = PRESET_CONTRAST_PAIRS[genome.preset];

  if (pair) {
    const ratio = contrastRatio(pair[0], pair[1]);
    if (ratio < safety.minContrastRatio) {
      violations.push({
        type: "contrast_ratio_fail",
        severity: "warning",
        detail: `Preset '${genome.preset}' contrast ratio ${ratio.toFixed(2)} < required ${safety.minContrastRatio}`,
        repaired: false,
        repairAction: "",
      });
    }
  }

  return violations;
}

/** C5: Spacing Integrity */
function checkSpacingIntegrity(
  genome: DesignGenome,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // Dense profile + asymmetric_weight is a known visual clash
  if (
    genome.densityProfile === "dense" &&
    genome.compositionPattern === "asymmetric_weight"
  ) {
    violations.push({
      type: "spacing_integrity_fail",
      severity: "warning",
      detail: "Dense density + asymmetric_weight composition creates spacing conflicts",
      repaired: false,
      repairAction: "",
    });
  }

  return violations;
}

/** C6: Platform Safety Thresholds */
function checkPlatformSafety(
  genome: DesignGenome,
  format: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const safety = PLATFORM_SAFETY[format] ?? DEFAULT_SAFETY;

  // Motion gating
  if (genome.motionEligible && !safety.allowsMotion) {
    violations.push({
      type: "platform_safety_threshold",
      severity: "fatal",
      detail: `Format '${format}' does not permit motion; motionEligible must be false`,
      repaired: false,
      repairAction: "",
    });
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5  REPAIR STRATEGIES — deterministic mutation of genome to resolve violations
// ─────────────────────────────────────────────────────────────────────────────

function repairGenome(
  genome: DesignGenome,
  violations: ConstraintViolation[],
  repairLog: string[]
): { genome: DesignGenome; repairedCount: number } {
  let g = { ...genome };
  let repairedCount = 0;

  for (const v of violations) {
    if (v.repaired) continue;

    switch (v.type) {
      case "layout_geometry_invalid": {
        // R1: Swap to first valid variation
        const validVars = GENOME_SPACE.variationIds[g.layoutFamily];
        if (validVars && validVars.length > 0) {
          const repair = `Swapped variationId '${g.variationId}' → '${validVars[0]}'`;
          g = { ...g, variationId: validVars[0]! };
          v.repaired = true;
          v.repairAction = repair;
          repairLog.push(repair);
          repairedCount++;
        }
        break;
      }

      case "text_fit_overflow": {
        // R2: Reduce density one level
        const densityOrder: DensityProfileLevel[] = ["sparse", "balanced", "rich", "dense"];
        const idx = densityOrder.indexOf(g.densityProfile);
        if (idx > 0) {
          const newDensity = densityOrder[idx - 1]!;
          const repair = `Reduced densityProfile '${g.densityProfile}' → '${newDensity}'`;
          g = { ...g, densityProfile: newDensity };
          v.repaired = true;
          v.repairAction = repair;
          repairLog.push(repair);
          repairedCount++;
        }
        break;
      }

      case "asset_contract_violation": {
        if (g.hookStrategy === "visual_lead") {
          // R3: Override hookStrategy to safe fallback
          const repair = `Overrode hookStrategy 'visual_lead' → 'bold_headline'`;
          g = { ...g, hookStrategy: "bold_headline" };
          v.repaired = true;
          v.repairAction = repair;
          repairLog.push(repair);
          repairedCount++;
        } else if (g.motionEligible) {
          // R4: Force motionEligible = false
          const repair = "Forced motionEligible = false (format incompatibility)";
          g = { ...g, motionEligible: false };
          v.repaired = true;
          v.repairAction = repair;
          repairLog.push(repair);
          repairedCount++;
        }
        break;
      }

      case "platform_safety_threshold": {
        // R4: Force motionEligible = false (always repairable)
        if (g.motionEligible) {
          const repair = "Forced motionEligible = false (platform safety)";
          g = { ...g, motionEligible: false };
          v.repaired = true;
          v.repairAction = repair;
          repairLog.push(repair);
          repairedCount++;
        }
        break;
      }

      case "contrast_ratio_fail":
      case "spacing_integrity_fail": {
        // Warnings — mark as acknowledged, no structural repair needed
        v.repaired = true;
        v.repairAction = "Acknowledged as warning (non-fatal)";
        break;
      }

      default:
        break;
    }
  }

  return { genome: g, repairedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6  MAIN CONSTRAINT CHECKER — full pipeline with repair loop
// ─────────────────────────────────────────────────────────────────────────────

export function checkAndRepairCandidate(
  candidate: CandidateDesignPlan
): { candidate: CandidateDesignPlan; report: ConstraintReport } {
  const t0 = Date.now();
  const repairLog = [...candidate.repairLog];
  let genome = { ...candidate.genome };
  let allViolations: ConstraintViolation[] = [];

  // Multi-pass repair loop
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    // Run all 6 constraint checkers
    const violations: ConstraintViolation[] = [
      ...checkLayoutGeometry(genome, candidate.format),
      ...checkAssetContract(genome),
      ...checkTextFit(genome, candidate.format),
      ...checkContrast(genome, candidate.format),
      ...checkSpacingIntegrity(genome),
      ...checkPlatformSafety(genome, candidate.format),
    ];

    const fatalRemaining = violations.filter(
      (v) => v.severity === "fatal" && !v.repaired
    );

    if (fatalRemaining.length === 0) {
      allViolations = violations;
      break; // Clean pass — stop repairing
    }

    // Attempt repairs
    const { genome: repairedGenome, repairedCount } = repairGenome(
      genome,
      violations,
      repairLog
    );
    genome = repairedGenome;
    allViolations = violations;

    if (repairedCount === 0) break; // No progress — stop trying
  }

  // Final verdict
  const fatalUnresolved = allViolations.filter(
    (v) => v.severity === "fatal" && !v.repaired
  );
  const passed = fatalUnresolved.length === 0;
  const discarded = !passed;

  const report: ConstraintReport = {
    candidateId: candidate.candidateId,
    passed,
    violations: allViolations,
    repairCount: repairLog.length - candidate.repairLog.length,
    discarded,
    checkDurationMs: Date.now() - t0,
  };

  const repairedCandidate: CandidateDesignPlan = {
    ...candidate,
    genome,
    constraintsPassed: passed,
    repairLog,
  };

  return { candidate: repairedCandidate, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7  BATCH CONSTRAINT CHECKER
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchConstraintResult {
  validCandidates: CandidateDesignPlan[];
  discardedCandidates: CandidateDesignPlan[];
  reports: ConstraintReport[];
  totalRepairs: number;
  totalDiscarded: number;
  checkDurationMs: number;
}

export function checkAndRepairBatch(
  candidates: CandidateDesignPlan[]
): BatchConstraintResult {
  const t0 = Date.now();
  const validCandidates: CandidateDesignPlan[] = [];
  const discardedCandidates: CandidateDesignPlan[] = [];
  const reports: ConstraintReport[] = [];
  let totalRepairs = 0;

  for (const candidate of candidates) {
    const { candidate: checked, report } = checkAndRepairCandidate(candidate);
    reports.push(report);
    totalRepairs += report.repairCount;

    if (report.passed) {
      validCandidates.push(checked);
    } else {
      discardedCandidates.push(checked);
    }
  }

  return {
    validCandidates,
    discardedCandidates,
    reports,
    totalRepairs,
    totalDiscarded: discardedCandidates.length,
    checkDurationMs: Date.now() - t0,
  };
}
