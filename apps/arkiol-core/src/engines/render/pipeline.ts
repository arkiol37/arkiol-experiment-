// src/engines/render/pipeline.ts
// Unified Render Pipeline
//
// Single entry point for ALL render operations. SVG, PNG, and GIF exports
// all call renderAsset() and receive identical zone-resolved layouts.
//
// Pipeline stages (in order):
//   1. resolveLayoutSpec()          — Layout Authority, deterministic
//   2. analyzeDensity()             — Typography & spacing budget
//   3. buildCompositionPlan()       — Asset contract + element roster
//   3c. detectMissingElements()     — Identify elements without URLs
//   3d. generateAssetOnDemand()     — AI-generate missing elements (kill-switch
//                                     gated, spend-guard gated, credit-deducted)
//   3e. Inject CDN URLs             — Resolved asset URLs injected back into plan
//   4. buildSvgContent()            — AI generates content within constraints
//   5. enforceHierarchy()           — Typographic rule enforcement
//   6. enforceStyle()               — Contrast + brand tone
//   7. render<Format>()             — Format-specific renderer
//   8. Assemble result              — Returns uniform PipelineResult
//
// NO renderer may bypass this pipeline. randomUUID() is replaced with
// deterministic ID derivation from the input seed.

import "server-only";
import { createHash }              from "crypto";
import { randomUUID }              from "crypto";
import sharp                       from "sharp";
import { resolveLayoutSpec, AuthorityContext } from "../layout/authority";
import {
  analyzeSectionStructure,
  analyzePopulatedSections,
  enforceSectionBands,
  type SectionReport,
  type SectionKind,
} from "../layout/section-structure";
import { adaptLayout }             from "../layout/adaptive-layout";
import { LayoutConstraintError }   from "../layout/layout-constraints";
import { detectCategoryPack }      from "../style/category-style-packs";
import { analyzeDensity }          from "../layout/density";
import { enforceStyle }            from "../layout/style-enforcer";
import { enforceHierarchy, TextContent } from "../hierarchy/enforcer";
import {
  buildCompositionPlan, compositionToPromptFragment, ElementPlacement,
  validateAssetPresence, enrichForPresence, type AssetPresenceViolation,
  validateHeroComposition,
} from "../assets/asset-selector";
import {
  validatePlacement, buildZoneOwnershipMap, totalDensityScore,
  motionCompatibleElements, ASSET_CONTRACTS,
} from "../assets/contract";
// ── Ultimate renderer — replaces svg-builder for Canva-quality output ─────────
import { buildUltimateSvgContent, renderUltimateSvg, type SvgContent, type BuildResult } from "./svg-builder-ultimate";
import { scoreCandidateQuality, scoreThemeQuality, computeRankScore } from "../evaluation/candidate-quality";
import type { TemplateType } from "../templates/template-types";
import { enforceMarketplaceStandard, type MarketplaceVerdict } from "../evaluation/marketplace-gate";
import { evaluateRejection } from "../evaluation/rejection-rules";
import {
  recordGenerationStart,
  recordGenerationSuccess,
  recordGenerationFailure,
  recordMarketplaceVerdict,
  recordHeroMissing,
  recordRecoveryActions,
} from "../../lib/generation-metrics";
import { assessDesignQuality, refineDesign, runRefinementPasses } from "../evaluation/candidate-refinement";
import { polishOutput } from "../evaluation/output-polish";
import { assessProductionReadiness, type ProductionReadinessReport } from "../evaluation/production-readiness";
import {
  createPipelineContext,
  type PipelineContext,
  type EnrichedBrief,
  type GuardCheckResult,
} from "./pipeline-types";
import {
  runSafeStage,
  healZoneGeometry,
  healContent,
  buildSafetyNetSvg,
  buildDegradedResult,
  runResilientRender,
  recoverMissingAssets,
  type RecoveryAction,
} from "./self-healing";
import { recordGeneration } from "../memory/generation-ledger";
import { extractEvaluationSignals } from "../memory/learning-signals";
import {
  recordSuccessfulPattern,
  type VisualPatternSignature,
} from "../memory/visual-patterns";
import { inferCategoryFromText } from "../../lib/asset-library";
import { recordQualitySignal } from "../intelligence/creative-loop";
import {
  orchestrateDesignAgents,
  runCriticPostGeneration,
  type AgentOrchestrationResult,
  type CriticVerdict,
} from "../agents/design-agents";
import { type PersonalizationContext } from "../personalization/dna-applicator";
import {
  renderGif,
  buildKineticTextFrames,
  buildFadeFrames,
  buildPulseCtaFrames,
  buildRevealFrames,
  GifFrame,
} from "./gif-renderer";
import { BriefAnalysis }           from "../ai/brief-analyzer";
import { FORMAT_DIMS }             from "../../lib/types";
import { logGenerationEvent }      from "../../lib/logger";
import { logger }                  from "../../lib/logger";
import { KillSwitchError }         from "../ai/pipeline-orchestrator";
import {
  detectMissingElements,
  generateAssetOnDemand,
  computeSimilarityHash,
  type AssetEngineDeps,
  type MissingElement,
  type GeneratedAsset,
  CREDIT_COSTS,
  checkKillSwitch,
  checkGlobalMonthlySpend,
} from "@arkiol/shared";

// ── SpendGuardError ───────────────────────────────────────────────────────────
// Thrown when the global monthly spend guard blocks asset generation.
// Treated identically to KillSwitchError by the worker: job is FAILED,
// credits are refunded, and a structured error response is returned.
export class SpendGuardError extends Error {
  readonly code: string;
  readonly jobId: string;
  readonly format: string;
  constructor(jobId: string, format: string, code: string, detail: string) {
    super(`Spend guard blocked asset generation: ${detail}`);
    this.jobId   = jobId;
    this.format  = format;
    this.code    = code;
    this.name    = "SpendGuardError";
  }
}

// ── AssetPresenceError ───────────────────────────────────────────────────────
// Thrown when the composition plan cannot satisfy the minimum visual-
// richness rules even after self-healing. Signals to callers that the
// template would ship with only text on a background, which we never want.
export class AssetPresenceError extends Error {
  readonly jobId: string;
  readonly format: string;
  readonly violations: AssetPresenceViolation[];
  constructor(jobId: string, format: string, violations: AssetPresenceViolation[]) {
    const details = violations.map(v => `${v.rule}: ${v.message}`).join(" | ");
    super(`Template rejected for insufficient visual richness: ${details}`);
    this.jobId      = jobId;
    this.format     = format;
    this.violations = violations;
    this.name       = "AssetPresenceError";
  }
}

// ── Pipeline inputs ───────────────────────────────────────────────────────────
export interface PipelineInput {
  // Job identity (for logging / error reporting)
  jobId?:       string;

  // Layout identity (all deterministic)
  format:       string;
  stylePreset:  string;
  variationIdx: number;
  campaignId:   string;

  // Content
  brief:        BriefAnalysis;
  brand?: {
    primaryColor:   string;
    secondaryColor: string;
    fontDisplay:    string;
    fontBody:       string;
    voiceAttribs?:  Record<string, number>;
  };

  // Output mode
  outputFormat: "svg" | "png" | "gif";
  gifStyle?:    "kinetic_text" | "fade" | "pulse_cta";  // only for gif

  // PNG options
  pngScale?: number;  // 1 = native, 2 = 2x, etc. Default: 1

  // GIF options
  gifFps?:     number;   // default: 12
  gifQuality?: number;   // 1 (best) – 20. Default: 10

  // Personalization — user style profile context
  personalization?: PersonalizationContext;

  // Step 42: pack anchor — when set, biases theme selection so all
  // variations in a gallery batch share palette + typography + corner
  // radius. Captured by the coordinator from the first successful
  // render and threaded into subsequent inputs. Subset mirrors
  // PipelineResult.packStyleSnapshot so round-tripping is clean.
  packAnchor?: {
    primary:      string;
    accent:       string;
    surface:      string;
    ink:          string;
    fontDisplay:  string;
    fontBody:     string;
    cornerRadius: number;
    ctaShadow:    boolean;
    firstTone?:   string;
  };

  // Step 25: template type override. When set, the renderer shapes the
  // theme to visibly announce this type (checklist, tips, quote,
  // step-by-step, list-based, promotional, educational, minimal). When
  // unset, the composer picks a type based on the brief + variationIdx
  // so a multi-variation gallery rotates through different types.
  templateType?: TemplateType;

  // ── On-Demand Asset Engine context ──────────────────────────────────────
  // Must be populated by the orchestrator from org/plan DB data.
  // If absent, asset generation is skipped (composition is text/gradient only).
  assetEngine?: {
    /** Injected dependencies — prisma + openai + S3 uploadFn */
    deps:               AssetEngineDeps;
    /** Job/org context for credit accounting and audit */
    orgId:              string;
    jobId:              string;
    /** From org.plan — gates HQ upgrade */
    planCanUseHq:       boolean;
    /** From getPlanConfig(org.plan).maxOnDemandAssets */
    maxOnDemandAssets:  number;
    /** Global monthly AI spend (USD) checked against GLOBAL_MONTHLY_SPEND_LIMIT_USD */
    globalMonthlySpendUsd: number;
    /** Brand palette for color harmonization on generated assets */
    palette:            string[];
    /** HQ upgrade explicitly requested by the user (never auto-applied) */
    hqUpgradeRequested: boolean;
    /** Style preset propagated into asset prompt construction */
    style?:             string;
    /** Credit deduction callback — invoked once per generated (non-cached) asset */
    onCreditDeduct:     (amount: number, reason: string, assetId: string) => Promise<void>;
    /** Credit refund callback — invoked if generation fails after deduction */
    onCreditRefund:     (amount: number, reason: string, assetId: string) => Promise<void>;
  };
}

// ── Generated asset injection map — CDN URLs keyed by element type ────────────
// Built during Stage 3d and passed into the SVG builder so generated images
// are embedded by reference rather than regenerated.
export interface InjectedAssetMap {
  /** element type (background/hero_image/icon/etc.) → CDN URL */
  [elementType: string]: string;
}

// ── Pipeline outputs ──────────────────────────────────────────────────────────
export interface PipelineResult {
  // Asset data
  buffer:       Buffer;
  mimeType:     "image/svg+xml" | "image/png" | "image/gif";
  svgSource:    string;     // always populated, even for PNG/GIF
  width:        number;
  height:       number;
  fileSize:     number;

  // Deterministic ID — derived from inputs, never random
  assetId:      string;

  // Quality metadata
  brandScore:     number;     // 0–100
  hierarchyValid: boolean;
  layoutFamily:   string;
  layoutVariation:string;
  violations:     string[];

  // Performance
  durationMs:   number;

  // Self-healing — populated when the pipeline recovered from failures
  recoveryActions?: Array<{
    stage: string;
    issue: string;
    action: string;
    severity: "warning" | "error" | "critical";
  }>;

  // Evaluation signals — quality metrics for feedback correlation
  evaluationSignals?: {
    qualityScore: number;
    designQualityScore: number;
    themeId: string;
  };

  // Strict quality verdict — consumed by the multi-candidate gallery flow
  // to decide whether a candidate is admitted or discarded before the
  // user sees it. Populated on every render that has a selected theme +
  // content. Encodes both the rejection-rule verdict and the marketplace
  // gate outcome so downstream batch filtering does not need to re-score.
  qualityVerdict?: {
    /** Passed every hard rejection rule (gradient-only, single-text-block,
     *  asset-poor, weak composition, repetition, etc). */
    rulesAccepted:       boolean;
    /** Marketplace gate approved the template as gallery-grade. */
    marketplaceApproved: boolean;
    /** Composite marketplace score for ranking survivors. */
    marketplaceScore:    number;
    /** Weighted quality score (0..1). */
    qualityScore:        number;
    /** Penalty-aware rank score (0..1) — primary selection signal. Empty
     *  / simple / repetitive / unbalanced / asset-poor outputs score
     *  lower here than on qualityScore because the rank score applies
     *  explicit penalties for those failure modes. */
    rankScore:           number;
    /** Top penalties that pulled the rank score down, highest first. */
    rankPenalties:       string[];
    /** Hard-rule reasons that fired, if any. */
    hardReasons:         string[];
    /** Soft-rule reasons (audit only). */
    softReasons:         string[];
    /** Marketplace criteria that failed, if any. */
    failedCriteria:      string[];
    /** Theme id picked for this render. */
    themeId:             string;
    /** Template type the composer shaped the render for
     *  (checklist / tips / quote / step-by-step / list-based /
     *   promotional / educational / minimal). Undefined when no theme
     *  was selected. */
    templateType?:       TemplateType;
    /** Populated sections (header / content / visual / list_block / cta /
     *  supporting) derived from the actual text zones that will render.
     *  A structurally valid template spans ≥ 2 sections with ≥ 1 anchor
     *  (header/content/cta/visual); the `single_block` rejection rule
     *  guards this at the hard gate, but the verdict surfaces the
     *  breakdown so downstream admission logs can describe *why* a
     *  template qualified. */
    sections?:           SectionKind[];
    sectionCount?:       number;
    sectionAnchorCount?: number;
    sectionsSatisfied?:  boolean;
    /** Structured component mix used by the renderer (checklist_item /
     *  tip_card / step_block / quote_box / content_card / cta_button /
     *  badge / labeled_section). Surfaces the distinct kinds and their
     *  total coverage so audit logs can explain *how* the template was
     *  composed — the `no_components` rejection rule guards the floor. */
    componentKinds?:     string[];
    componentCount?:     number;
    structuredComponentCount?: number;
    componentsSatisfied?: boolean;
    /** Content-aware restructuring summary — what kind of content the
     *  composer read (list / checklist / steps / tips / informational /
     *  quote / prose) and how many structured items shipped. The
     *  `unstructured_content` rejection rule uses this floor; the
     *  verdict exposes it so admission audits can show *why* a
     *  list-style template shipped with only two bullets. */
    contentKind?:        string;
    contentItems?:       number;
    contentItemsRequired?: number;
    contentSatisfied?:   boolean;
    /** Where the zone text came from — `openai_structured` when the
     *  template-type-aware generator produced the headline + items,
     *  `legacy_zone_text` when the generic zone-text fallback ran,
     *  `fallback` when no AI was available and we used the brief alone. */
    contentSource?:      "openai_structured" | "legacy_zone_text" | "fallback";
    /** Count of distinct structured items (tips / checklist rows / steps /
     *  benefits / insights / list picks) the model delivered. Zero for
     *  quote / minimal templates which intentionally have no list. */
    structuredItemCount?: number;
    /** Step 8 — per-role mapping of structured content onto zones.
     *  The `unmapped_content` / `underfilled_components` /
     *  `compressed_content` rejection rules read this. Surfaced here so
     *  admission audits can describe *why* a template shipped with
     *  scattered items or dropped required fields. */
    mappingExpectedItems?:  number;
    mappingPlacedItems?:    number;
    mappingMissingRoles?:   string[];
    mappingUnderfilled?:    boolean;
    mappingCompressed?:     boolean;
    mappingSlotCount?:      number;
    /** Step 9 — real visual subject selected for the image zone.
     *  Populated when the brief's imageStyle expects a photo and a
     *  manifest entry matched the brief's category. Consumed by the
     *  `missing_subject_image` rejection rule and surfaced here so
     *  admission logs can show which photo slug landed on each
     *  variation. */
    subjectImageSlug?:      string;
    subjectImageCategory?:  string;
    subjectImageRealm?:     string;
    subjectImagePlacement?: string;
    subjectImageLicensed?:  boolean;
    subjectImageExpected?:  boolean;
  };

  // Step 39 wiring: optional pack-style snapshot so the multi-output
  // coordinator (generateVariations) can extract a PackAnchor from the
  // first successful candidate and apply it to subsequent variations.
  // Minimal subset of DesignTheme — just what extractPackAnchor reads.
  packStyleSnapshot?: {
    primary:   string;
    accent:    string;
    surface:   string;
    ink:       string;
    fontDisplay: string;
    fontBody:    string;
    cornerRadius: number;
    ctaShadow:   boolean;
    firstTone?:  string;
  };

  // Production readiness — overall quality verdict
  productionReadiness?: {
    verdict: "ready" | "needs_review" | "reject";
    overallScore: number;
    blockers: string[];
    warnings: string[];
  };

  // Agent orchestration — design planning decisions made before generation
  agentOrchestration?: {
    direction: AgentOrchestrationResult["direction"];
    plan: AgentOrchestrationResult["plan"];
    preFlightVerdict: AgentOrchestrationResult["preFlightVerdict"];
    postGenerationVerdict?: CriticVerdict;
    adjustmentsApplied: string[];
  };

  // ── Editor element tree — zones + final SvgContent for ArkiolEditor ─────
  // Populated on every successful render so EditorShell can open generated
  // designs as fully-editable layer trees without re-parsing SVG text.
  editorZones?:      unknown[];   // Zone[] — serialised for JSON transport
  editorSvgContent?: unknown;     // SvgContent — the final style-enforced content

  // ── On-Demand Asset Engine metadata ──────────────────────────────────────
  // Populated when assetEngine context was provided and at least one element
  // was resolved via generateAssetOnDemand().
  onDemandAssets?: {
    /** Total credits charged for AI-generated sub-assets this render */
    totalCreditCost:     number;
    /** Total USD cost to provider APIs for this render */
    totalProviderCostUsd: number;
    /** Number of elements resolved from similarity-hash cache (creditCost=0) */
    cacheHits:           number;
    /** Number of elements resolved from curated library (creditCost=0) */
    libraryHits:         number;
    /** Number of elements newly generated via AI */
    aiGenerations:       number;
    /** Per-element generation results (for audit trail) */
    elements:            Array<{
      elementId:    string;
      elementType:  string;
      cdnUrl:       string;
      source:       string;   // 'cache' | 'library' | 'ai_generated'
      creditCost:   number;
      cacheHit:     boolean;
      durationMs:   number;
    }>;
  };
}

// ── Deterministic asset ID ────────────────────────────────────────────────────
function deriveAssetId(
  campaignId:   string,
  format:       string,
  variationIdx: number,
  outputFormat: string
): string {
  return createHash("sha256")
    .update(`asset:${campaignId}:${format}:${variationIdx}:${outputFormat}`)
    .digest("hex")
    .slice(0, 24);
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
export async function renderAsset(input: PipelineInput): Promise<PipelineResult> {
  const ctx = createPipelineContext(input);
  const startMs = ctx.startedAt;
  const violations = ctx.violations;
  const recoveryLog: RecoveryAction[] = [];

  // Metrics: tick generation-start counter. Success / failure / latency
  // are recorded on the way out.
  recordGenerationStart();

  // Top-level safety net — guarantees a result even on catastrophic failure.
  // Hard failures (KillSwitchError, SpendGuardError, AssetPresenceError) are
  // re-thrown so the worker can handle billing / rejection correctly.
  // Everything else returns a degraded result.
  try {
    const result = await renderAssetInner(input, ctx, violations, recoveryLog);
    recordGenerationSuccess(Date.now() - startMs);
    if (recoveryLog.length > 0) recordRecoveryActions(recoveryLog.length);
    return result;
  } catch (err: any) {
    if (err?.name === "KillSwitchError" ||
        err?.name === "SpendGuardError" ||
        err?.name === "AssetPresenceError" ||
        err?.name === "LayoutConstraintError" ||
        err?.name === "MarketplaceQualityError") {
      recordGenerationFailure(err?.name ?? "unknown");
      throw err;
    }

    const durationMs = Date.now() - startMs;
    logger.error(
      { jobId: input.jobId, format: input.format, error: err?.message, stack: err?.stack },
      "[self-healing] Pipeline failed catastrophically — returning safety-net result",
    );
    recoveryLog.push({
      stage: "output",
      issue: err?.message ?? "unknown catastrophic failure",
      action: "Returned safety-net SVG to prevent crash",
      severity: "critical",
      timestamp: Date.now(),
    });

    recordGenerationFailure(err?.message ?? "unknown");
    const degraded = buildDegradedResult(input, recoveryLog);
    degraded.durationMs = durationMs;
    logGenerationEvent(input.format, input.stylePreset, durationMs, false);
    return degraded;
  }
}

async function renderAssetInner(
  input: PipelineInput,
  ctx: PipelineContext,
  violations: string[],
  recoveryLog: RecoveryAction[],
): Promise<PipelineResult> {
  const startMs = ctx.startedAt;

  // ── Agent orchestration — design planning before generation ────────────
  // The three-agent "thinking layer" runs deterministically:
  //   Creative Director → Designer → Critic (pre-flight)
  // Produces a design plan that influences theme selection and informs the
  // post-generation critic. Wrapped in try-catch so agent bugs never crash
  // the pipeline.
  let agentResult: AgentOrchestrationResult | null = null;
  try {
    agentResult = orchestrateDesignAgents(
      input.brief,
      input.format,
      input.brand ? { primaryColor: input.brand.primaryColor, secondaryColor: input.brand.secondaryColor } : undefined,
    );
    if (agentResult.adjustmentsApplied.length > 0) {
      violations.push(...agentResult.adjustmentsApplied.map(a => `agent:pre_flight_fix: ${a}`));
    }
    if (agentResult.preFlightVerdict.issues.length > 0) {
      violations.push(...agentResult.preFlightVerdict.issues.map(i => `agent:pre_flight_issue: ${i}`));
    }
  } catch (agentErr: any) {
    recoveryLog.push({
      stage: "init",
      issue: agentErr?.message ?? "agent orchestration failed",
      action: "Skipped agent planning — proceeding with default pipeline",
      severity: "warning",
      timestamp: Date.now(),
    });
  }

  // ── Stage 1: Layout Authority ──────────────────────────────────────────
  const detectedCategoryId = detectCategoryPack(input.brief)?.id;
  const authCtx: AuthorityContext = {
    format:       input.format,
    stylePreset:  input.stylePreset,
    variationIdx: input.variationIdx,
    campaignId:   input.campaignId,
    briefLength:  getBriefLength(input.brief),
    categoryId:   detectedCategoryId,
  };
  const rawSpec = resolveLayoutSpec(authCtx);

  // ── Stage 1b: Adaptive layout — constraint-based zone adjustment ──────
  // Adjusts zone geometry based on content signals from the brief.
  // Runs after Authority (preserves family/variation) but before Density
  // (so font budgets are computed on the adapted zones).
  const adapted = adaptLayout({
    zones:          rawSpec.zones,
    brief:          input.brief,
    formatCategory: rawSpec.formatCategory,
    density:        rawSpec.density,
    activeZoneIds:  rawSpec.activeZoneIds,
    categoryId:     detectedCategoryId,
  });
  // Heal zone geometry — clamp negative dimensions, out-of-bounds positions
  const canvasDims = FORMAT_DIMS[input.format] ?? { width: 1080, height: 1080 };
  const zoneHealing = healZoneGeometry(adapted.zones, canvasDims.width, canvasDims.height);
  if (zoneHealing.actions.length > 0) {
    recoveryLog.push(...zoneHealing.actions);
    violations.push(...zoneHealing.actions.map(a => `self_healing:zone: ${a.issue}`));
  }

  // ── Structured-section enforcement ─────────────────────────────────────
  // Every template must render as a real composition — a header / content
  // / visual / cta cluster, not a single floating text block. We classify
  // every active zone into a section, snap zones whose center-Y already
  // lands in a canonical band to that band's midline (gentle ±4% nudge
  // — custom variations keep their distinctive shape), and record the
  // structural report on the pipeline context for downstream stages.
  const bandsAdjusted = enforceSectionBands(zoneHealing.zones);
  if (bandsAdjusted.nudged.length > 0) {
    violations.push(`section_bands:nudged=${bandsAdjusted.nudged.join(",")}`);
  }
  const sectionReport: SectionReport = analyzeSectionStructure(
    bandsAdjusted.zones,
    rawSpec.activeZoneIds,
  );
  if (sectionReport.issues.length > 0) {
    violations.push(...sectionReport.issues.map(i => `section_structure:${i}`));
  }

  const spec = { ...rawSpec, zones: bandsAdjusted.zones };
  ctx.currentStage = "layout";
  ctx.layout = { rawSpec, adapted, spec };
  if (adapted.adjustments.length > 0) {
    violations.push(...adapted.adjustments.map(a => `adaptive_layout:${a}`));
  }

  // ── Strict constraint gate ──────────────────────────────────────────────
  // Reject templates that would reach the gallery with critical layout
  // violations (margins/safe zones, spacing, alignment, balance, mechanical
  // placement). Phase 7 inside adaptLayout auto-resolved what it could; any
  // remaining `blocking` report means the layout is unsafe to ship.
  if (adapted.constraintReport?.blocking) {
    throw new LayoutConstraintError(
      input.format,
      adapted.constraintReport.violations,
      adapted.constraintReport.score,
    );
  }

  // ── Stage 2: Density analysis ──────────────────────────────────────────
  const densityAnalysis = analyzeDensity(spec, {
    headline: input.brief.headline,
    subhead:  input.brief.subhead,
    body:     input.brief.body,
  });

  ctx.currentStage = "density";
  ctx.density = { analysis: densityAnalysis };

  // ── Stage 3: Composition plan ──────────────────────────────────────────
  const isGif = input.outputFormat === "gif";
  const composition = buildCompositionPlan(input.brief, spec, isGif);

  // ── Stage 3b: AssetContract validation gate ───────────────────────────
  // Enforce zone ownership, density limits, hierarchy weights, and motion
  // compatibility BEFORE any AI call. Violations are auto-corrected where
  // possible; errors halt the pipeline.
  const contractViolations: string[] = [];

  // Zone ownership conflicts
  const placements = composition.elements.map(e => ({ type: e.type, zone: e.zone }));
  const { conflicts: ownershipConflicts } = buildZoneOwnershipMap(placements);
  contractViolations.push(...ownershipConflicts.map(c => `contract:ownership: ${c}`));

  // Density limit check
  const totalDensity = totalDensityScore(composition.elements.map(e => e.type));
  if (totalDensity > 120) {
    contractViolations.push(`contract:density: totalDensity=${totalDensity} exceeds limit of 120`);
    // Auto-correct: remove lowest-priority optional elements until under limit
    while (composition.elements.length > 1 &&
           totalDensityScore(composition.elements.map(e => e.type)) > 120) {
      const removable = composition.elements.filter(e => e.type !== "background");
      if (!removable.length) break;
      const lowest = removable.sort((a, b) =>
        ASSET_CONTRACTS[a.type].densityLimit - ASSET_CONTRACTS[b.type].densityLimit
      )[0];
      composition.elements = composition.elements.filter(e => e !== lowest);
    }
  }

  // Per-element placement checks
  for (const el of composition.elements) {
    const violations = validatePlacement(el.type, el.zone, input.format, el.coverageHint);
    for (const v of violations) {
      if (v.severity === "error") {
        contractViolations.push(`contract:placement: ${v.issue}`);
      }
    }
  }

  // GIF motion compatibility
  if (isGif) {
    const incompatible = composition.elements.filter(e =>
      !ASSET_CONTRACTS[e.type].motionCompatible
    );
    if (incompatible.length > 0) {
      contractViolations.push(
        `contract:motion: elements not GIF-compatible: ${incompatible.map(e => e.type).join(", ")}`
      );
      composition.elements = composition.elements.filter(e =>
        ASSET_CONTRACTS[e.type].motionCompatible
      );
    }
  }

  violations.push(...contractViolations);

  // ── Stage 3b.1: Asset-presence enforcement ───────────────────────────
  // Reject templates that would ship with only text on a background. Tries
  // a single self-heal via category-matched library assets first — hard-
  // rejects only if the layout truly cannot hold any visual asset.
  let presenceViolations = validateAssetPresence(composition);
  const presenceErrors = presenceViolations.filter(v => v.severity === "error");
  if (presenceErrors.length > 0) {
    const heal = enrichForPresence(composition, spec, input.brief, isGif);
    composition.elements = heal.plan.elements;
    if (heal.added.length > 0) {
      violations.push(
        `asset_presence:self_heal: injected ${heal.added.length} library asset(s) — ${heal.added.join(", ")}`
      );
    }
    presenceViolations = validateAssetPresence(composition);
    const stillFailing = presenceViolations.filter(v => v.severity === "error");
    if (stillFailing.length > 0) {
      throw new AssetPresenceError(
        input.jobId ?? "",
        input.format,
        stillFailing,
      );
    }
  }
  violations.push(
    ...presenceViolations.map(v => `asset_presence:${v.rule}[${v.severity}]: ${v.message}`)
  );

  // ── Step 37: Hero composition enforcement ────────────────────────────
  // Every template must declare one primary visual with a clear
  // compositionMode (background / side / framed). Validation happens
  // *after* presence healing so self-healed assets get a fair chance
  // to be promoted. Errors surface as violations but don't throw —
  // the marketplace gate downstream weights them via the `layered`
  // and `assetRich` criteria.
  const heroIssues = validateHeroComposition(composition, spec.activeZoneIds);
  for (const h of heroIssues) {
    violations.push(`hero_composition:${h.rule}[${h.severity}]: ${h.message}`);
    if (h.rule === "hero_missing") recordHeroMissing();
  }

  ctx.currentStage = "composition";
  ctx.composition = { plan: composition, contractViolations };

  // ── Stage 3c/3d: On-Demand Asset Generation ───────────────────────────
  // Detect composition elements without asset URLs, generate them via AI,
  // and inject the returned CDN URLs back into the composition before the SVG
  // builder runs. Cache hits are free; AI generation deducts credits atomically.
  //
  // Guards applied in order:
  //   1. assetEngine context must be present (opt-in from orchestrator)
  //   2. Global kill-switch must be off
  //   3. Global monthly spend guard must not be exceeded
  //   4. Plan-based on-demand asset count limit
  //   5. HQ upgrade only if explicitly user-requested and plan allows
  //   6. Similarity hash dedup (cache hit → no AI call, no credit deduction)
  //   7. Per-element credit deduction after successful generation
  //   8. Per-element credit refund on failure

  const injectedAssets: InjectedAssetMap = {};
  const onDemandMeta: NonNullable<PipelineResult["onDemandAssets"]> = {
    totalCreditCost:      0,
    totalProviderCostUsd: 0,
    cacheHits:            0,
    libraryHits:          0,
    aiGenerations:        0,
    elements:             [],
  };

  if (input.assetEngine) {
    const ae = input.assetEngine;

    // ── Kill-switch gate (HARD BLOCK) ────────────────────────────────────
    // If the global kill-switch is active, this is an ops emergency halt.
    // We must NOT silently degrade — assets must not be generated for free,
    // billing integrity must be preserved, and the caller must know why the
    // job was blocked. Throw so the worker catches it as KillSwitchError,
    // marks the job FAILED, refunds any pre-deducted credits, and logs the
    // block reason in the job record.
    const killResult = checkKillSwitch() as GuardCheckResult;
    if (!killResult.allowed) {
      logGenerationEvent(input.format, input.stylePreset, 0, false);
      logger.warn({
        jobId:  input.jobId,
        format: input.format,
        reason: killResult.reason,
        code:   killResult.code,
      }, '[pipeline] KILL_SWITCH_ACTIVE — hard-blocking asset engine stage');
      // Re-throw as KillSwitchError so the generation worker handles it
      // with the correct job-failure flow (credit refund, structured error response).
      throw new KillSwitchError(input.jobId ?? '', input.format);
    }

    // ── Global monthly spend guard (HARD BLOCK) ───────────────────────────
    // If the spend guard triggers (limit reached, misconfigured, or spend
    // calculation failed) we must NEVER silently skip AI and deliver an
    // asset-free render without informing the caller. Throw SpendGuardError
    // so the worker marks the job FAILED and preserves billing integrity.
    const spendResult = checkGlobalMonthlySpend(ae.globalMonthlySpendUsd) as GuardCheckResult;
    if (!spendResult.allowed) {
      logGenerationEvent(input.format, input.stylePreset, 0, false);
      logger.warn({
        jobId:        input.jobId,
        format:       input.format,
        currentSpend: ae.globalMonthlySpendUsd,
        reason:       spendResult.reason,
        code:         spendResult.code,
      }, '[pipeline] SPEND_GUARD_ACTIVE — hard-blocking asset engine stage');
      throw new SpendGuardError(
        input.jobId ?? '',
        input.format,
        spendResult.code ?? 'SPEND_GUARD_ACTIVE',
        spendResult.reason
      );
    }

    // ── Build TemplateElement list from composition elements ────────
        // Map ElementPlacement → TemplateElement for detectMissingElements()
        const templateElements = composition.elements.map(el => ({
          id:       el.type,     // element type used as ID (background/human/object/etc.)
          type:     el.type,
          url:      el.url,
          required: el.type === "background",  // background is always critical
          width:    spec.zones.find(z => z.id === el.zone)?.width  ?? 1024,
          height:   spec.zones.find(z => z.id === el.zone)?.height ?? 1024,
          context:  el.prompt,
        }));

        const missingElements = detectMissingElements(templateElements);

        if (missingElements.length > 0) {
          // ── Plan-based on-demand asset count enforcement ──────────────
          const planConfig = { maxOnDemandAssets: ae.maxOnDemandAssets };
          const clampedMissing = missingElements.slice(0, planConfig.maxOnDemandAssets);

          if (missingElements.length > planConfig.maxOnDemandAssets) {
            violations.push(
              `asset_engine:count_limit: plan allows ${planConfig.maxOnDemandAssets} on-demand assets, ` +
              `${missingElements.length} requested — truncated to ${planConfig.maxOnDemandAssets}`
            );
          }

          // ── Generate each missing element (concurrent, bounded by plan) ─
          // We process concurrently but respect the plan's maxOnDemandAssets cap.
          // Each element is independently credit-deducted. Failures are non-fatal
          // (element skipped, violation logged) to preserve overall render integrity.
          await Promise.all(clampedMissing.map(async (missingEl: MissingElement) => {
            // HQ is ONLY applied if user explicitly requested it AND plan allows.
            // Never auto-upgrade. This is a hard design invariant.
            const quality = (ae.hqUpgradeRequested && ae.planCanUseHq) ? "hq" : "standard";
            const expectedCreditCost = quality === "hq"
              ? CREDIT_COSTS.asset_on_demand_hq
              : missingEl.elementType === "hero_image" || missingEl.elementType === "background"
                ? CREDIT_COSTS.asset_on_demand
                : CREDIT_COSTS.asset_on_demand;

            const requestId = `${ae.jobId}_${missingEl.elementId}_${randomUUID().slice(0, 8)}`;

            let genResult: Awaited<ReturnType<typeof generateAssetOnDemand>> | null = null;
            try {
              genResult = await generateAssetOnDemand(
                {
                  requestId,
                  missingEl,
                  assetType:          "photoreal", // default; override per elementType below
                  quality,
                  palette:            ae.palette,
                  style:              ae.style,
                  orgId:              ae.orgId,
                  planCanUseHq:       ae.planCanUseHq,
                  maxOnDemandAssets:  ae.maxOnDemandAssets,
                  expectedCreditCost,
                  safetyLevel:        "strict",
                },
                ae.deps
              );
            } catch (assetErr: any) {
              // Asset generation failure is non-fatal at the pipeline level.
              // Log the violation and continue — element will be absent from SVG.
              violations.push(
                `asset_engine:generation_failed [${missingEl.elementId}]: ${assetErr.message}`
              );
              return;
            }

            if (!genResult || !genResult.ok) return;

            const asset = genResult.asset;

            // ── Credit deduction (only for AI-generated, not cache/library) ─
            // BILLING INTEGRITY: if deduction fails, we MUST NOT inject the asset.
            // An asset that bypasses billing would corrupt the credit ledger.
            // We remove any URL already written to injectedAssets and skip the
            // composition element update so the SVG builder never sees this asset.
            if (!genResult.cacheHit && genResult.source === "ai_generated" && genResult.creditCost > 0) {
              let deductionOk = true;
              try {
                await ae.onCreditDeduct(genResult.creditCost, `on_demand_asset:${missingEl.elementType}`, asset.id);
              } catch (deductErr: any) {
                deductionOk = false;
                violations.push(`asset_engine:credit_deduct_failed [${asset.id}]: ${deductErr.message}`);
                // Attempt refund in case deductCredits partially wrote anything.
                try {
                  await ae.onCreditRefund(genResult.creditCost, `on_demand_asset_deduct_failed:${missingEl.elementType}`, asset.id);
                } catch { /* refund failure is logged separately by the worker */ }
              }
              if (!deductionOk) return; // do not inject or update metadata for this element
            }

            // ── Inject CDN URL back into composition ────────────────────
            // Only reached if deduction succeeded (or asset was free / cache/library).
            // The SVG builder reads injectedAssets to embed image hrefs.
            const cdnUrl = asset.cdnUrl ?? asset.url;
            if (cdnUrl) {
              injectedAssets[missingEl.elementType] = cdnUrl;
              // Propagate URL back onto the composition element so the
              // compositionFragment is accurate for the SVG prompt.
              const composEl = composition.elements.find(e => e.type === missingEl.elementId);
              if (composEl) composEl.url = cdnUrl;
            }

            // ── Update metadata ─────────────────────────────────────────
            onDemandMeta.totalCreditCost      += genResult.creditCost;
            onDemandMeta.totalProviderCostUsd += genResult.providerCostUsd;
            if (genResult.cacheHit)                       onDemandMeta.cacheHits++;
            else if (genResult.source === "library")      onDemandMeta.libraryHits++;
            else if (genResult.source === "ai_generated") onDemandMeta.aiGenerations++;

            onDemandMeta.elements.push({
              elementId:   missingEl.elementId,
              elementType: missingEl.elementType,
              cdnUrl:      cdnUrl ?? "",
              source:      genResult.source,
              creditCost:  genResult.creditCost,
              cacheHit:    genResult.cacheHit,
              durationMs:  genResult.durationMs,
            });
          }));
        }
  }

  // Step 32: missing-asset recovery. After on-demand resolution, drop any
  // composition elements that ended up with neither a URL nor a prompt,
  // and any image-type elements that require a URL but didn't get one
  // (AI generation failed or upstream asset not materialized). Prevents
  // broken placements from reaching the SVG builder.
  const beforeCount = composition.elements.length;
  composition.elements = recoverMissingAssets(
    composition.elements,
    recoveryLog,
    { requireUrlForTypes: ["human", "object"] },
  );
  const droppedCount = beforeCount - composition.elements.length;
  if (droppedCount > 0) {
    violations.push(`self_healing:assets: dropped ${droppedCount} unrenderable placement(s)`);
  }

  ctx.currentStage = "assets";
  ctx.assets = {
    injectedAssets,
    resolvedAssets: onDemandMeta.elements,
    totalCreditCost: onDemandMeta.totalCreditCost,
    totalProviderCostUsd: onDemandMeta.totalProviderCostUsd,
    cacheHits: onDemandMeta.cacheHits,
    libraryHits: onDemandMeta.libraryHits,
    aiGenerations: onDemandMeta.aiGenerations,
  };

  // ── Stage 4: AI content generation (Ultimate — text-only, theme handles visuals)
  // Inject density suggestions, composition plan, and resolved asset CDN URLs
  // into the build context so the SVG builder embeds real images.
  const enrichedBrief: EnrichedBrief = {
    ...input.brief,
    _densitySuggestions: densityAnalysis.suggestions,
    _compositionFragment: compositionToPromptFragment(composition),
    _injectedAssets: injectedAssets,
  };

  ctx.currentStage = "render";
  // Step 32: resilient render loop. Retries on throw OR weak score using a
  // permuted variationIdx per attempt; keeps the best across attempts.
  // Previously a single thrown render fell straight through to the
  // catastrophic fallback; now we try once more with an alternate
  // variation before giving up.
  const resilientRender = await runResilientRender<BuildResult>({
    stage:              "render",
    maxAttempts:        2,
    baseVariationIdx:   input.variationIdx,
    weakScoreThreshold: undefined, // score-based retry handled by quality gate below
    recoveryLog,
    render: async (variationIdx) => {
      const result = await buildUltimateSvgContent(
        spec.zones,
        enrichedBrief,
        input.format,
        input.brand,
        variationIdx,
        agentResult?.plan.themePreferences,
        input.personalization,
        input.packAnchor,
        input.templateType,
      );
      return { result };
    },
  });
  let buildResult = resilientRender.result;
  if (resilientRender.attempts > 1) {
    violations.push(
      `self_healing:render: recovered on attempt ${resilientRender.attempts}/2 (${resilientRender.reason})`,
    );
  }
  ctx.render = { content: buildResult.content as SvgContent, violations: buildResult.violations };

  // ── Content integrity healing — fix invalid colors, NaN font sizes ──────
  const contentHealing = healContent(buildResult.content as SvgContent, "#f8f7f4");
  if (contentHealing.actions.length > 0) {
    recoveryLog.push(...contentHealing.actions);
    violations.push(...contentHealing.actions.map(a => `self_healing:content: ${a.issue}`));
    buildResult = { content: contentHealing.content, violations: buildResult.violations };
  }

  // ── Quality gate: assess design quality, auto-refine, reject bland outputs ──
  // Wrapped in try-catch so scoring bugs never crash the pipeline.
  const QUALITY_RETRY_THRESHOLD = 0.32;
  const DESIGN_QUALITY_FLOOR = 0.50;
  const selectedTheme = buildResult.content._selectedTheme;
  let qualityGateRefined = false;
  let qualityGateRetried = false;

  try {
    if (selectedTheme) {
      const qScore = scoreCandidateQuality(selectedTheme, buildResult.content as SvgContent);

      const designReport = assessDesignQuality(
        buildResult.content as SvgContent,
        spec.zones,
        input.format,
      );

      if (designReport.overall < DESIGN_QUALITY_FLOOR || designReport.issues.some(i => i.severity === "error")) {
        // Step 24: multi-pass auto-refinement. A single pass can create new
        // issues (raising a headline to fix hierarchy may cause overflow),
        // so we iterate until the fix set stabilizes or we hit the pass cap.
        // Covers contrast, overflow, hierarchy, and clutter fixes; alignment
        // and balance remain assessed but not auto-fixable at this layer.
        const refinement = runRefinementPasses(
          buildResult.content as SvgContent,
          spec.zones,
          { format: input.format, maxPasses: 3 },
        );
        if (refinement.actions.length > 0) {
          buildResult = { content: refinement.content, violations: buildResult.violations };
          qualityGateRefined = true;
          buildResult.violations.push(
            `refinement:passes=${refinement.passesRun},stabilized=${refinement.stabilized},actions=${refinement.actions.length}`,
          );
        }
      }

      const combinedScore = qScore.total * 0.5 + designReport.overall * 0.5;

      if (combinedScore < QUALITY_RETRY_THRESHOLD) {
        qualityGateRetried = true;
        const retryResult = await buildUltimateSvgContent(
          spec.zones,
          enrichedBrief,
          input.format,
          input.brand,
          input.variationIdx + 13337,
          agentResult?.plan.themePreferences,
          input.personalization,
          input.packAnchor,
          input.templateType,
        );
        const retryTheme = retryResult.content._selectedTheme;
        if (retryTheme) {
          const retryQScore = scoreCandidateQuality(retryTheme, retryResult.content as SvgContent);
          const retryDesignReport = assessDesignQuality(
            retryResult.content as SvgContent,
            spec.zones,
            input.format,
          );
          const retryCombined = retryQScore.total * 0.5 + retryDesignReport.overall * 0.5;
          if (retryCombined > combinedScore) {
            buildResult = retryResult;
          }
        }
      }
    }
  } catch (qErr: any) {
    recoveryLog.push({
      stage: "quality_gate",
      issue: qErr?.message ?? "quality gate scoring failed",
      action: "Skipped quality gate — proceeding with unscored output",
      severity: "error",
      timestamp: Date.now(),
    });
    violations.push(`self_healing:quality_gate: scoring failed — ${qErr?.message}`);
  }

  ctx.currentStage = "quality_gate";
  ctx.qualityGate = {
    themeScore: undefined,
    designReport: undefined,
    combinedScore: 0,
    refined: qualityGateRefined,
    retried: qualityGateRetried,
  };
  violations.push(...buildResult.violations);

  // ── Step 38: Marketplace quality enforcement ──────────────────────────
  // Runs the marketplace gate at the pipeline level with the full
  // composition context (hero presence from Step 37, visualStyle list
  // from Step 36) threaded in. Operates in two modes:
  //   Strict  (ARKIOL_STRICT_MARKETPLACE=1): throws
  //           MarketplaceQualityError on failure so the worker drops
  //           the candidate before it reaches the gallery.
  //   Default: logs the verdict as violations; downstream batch
  //           selection / rejection-rules do the filtering.
  let marketplaceVerdict: MarketplaceVerdict | undefined;
  try {
    const buildContent = buildResult.content as SvgContent;
    const heroEl       = composition.elements.find(e => e.primary);
    // placedStyles surfaces the visualStyle axis (Step 36) so the
    // styleConsistent criterion can check mix. Pipeline doesn't
    // currently carry per-element style through the composition plan
    // (that lives in the asset library), so we pass an empty array
    // for now — the gate treats it as "not supplied" and skips the
    // check, preserving behavior while the wiring lands in a later
    // step that threads selection context all the way through.
    const placedStyles: (string | undefined)[] = [];

    if (buildContent._selectedTheme) {
      const strictGate = typeof process !== "undefined"
        ? (process.env as Record<string, string | undefined>).ARKIOL_STRICT_MARKETPLACE === "1"
        : false;
      const verdict = enforceMarketplaceStandard(
        {
          theme:            buildContent._selectedTheme,
          content:          buildContent,
          zones:            spec.zones,
          format:           input.format,
          brief:            input.brief,
          refinementPassed: qualityGateRefined || !qualityGateRetried,
          heroPresent:      !!heroEl && !!heroEl.compositionMode,
          placedStyles,
        },
        {
          jobId:  input.jobId,
          format: input.format,
          strict: strictGate,
        },
      );
      marketplaceVerdict = verdict;
      recordMarketplaceVerdict(verdict.approved, verdict.failedCriteria);
      violations.push(
        `marketplace_gate:${verdict.approved ? "APPROVED" : "REJECTED"} ` +
        `score=${verdict.marketplaceScore.toFixed(2)}` +
        (verdict.failedCriteria.length > 0
          ? ` failed=[${verdict.failedCriteria.join(",")}]`
          : ""),
      );
    }
  } catch (gateErr: any) {
    if (gateErr?.name === "MarketplaceQualityError") throw gateErr;
    recoveryLog.push({
      stage:     "marketplace_gate",
      issue:     gateErr?.message ?? "marketplace gate failed",
      action:    "Skipped marketplace gate — proceeding with unscored output",
      severity:  "warning",
      timestamp: Date.now(),
    });
  }

  // ── Stage 5: Hierarchy enforcement ────────────────────────────────────
  const hierarchyResult = enforceHierarchy(
    spec.zones,
    buildResult.content.textContents as TextContent[]
  );
  violations.push(...hierarchyResult.violations.map(v => `hierarchy:${v.zoneId}: ${v.issue} → ${v.applied}`));

  ctx.currentStage = "hierarchy";
  const finalContent: SvgContent = {
    ...buildResult.content,
    textContents: hierarchyResult.contents as SvgContent["textContents"],
  };
  ctx.hierarchy = { result: hierarchyResult, content: finalContent };

  // ── Stage 6: Style enforcement (contrast + brand tone) ─────────────────
  const styleResult = enforceStyle(
    hierarchyResult.contents,
    finalContent.backgroundColor,
    input.brand
  );
  violations.push(...styleResult.violations.map(v => `style:${v.zoneId}: ${v.issue} → ${v.correction}`));

  ctx.currentStage = "style_enforcement";
  const styleEnforcedContent: SvgContent = {
    ...finalContent,
    textContents: styleResult.contents as SvgContent["textContents"],
  };
  ctx.styleEnforcement = { result: styleResult, content: styleEnforcedContent };

  // ── Stage 6b: Output polish — final cleanup before rendering ──────────
  // Rounds font sizes, snaps weights, normalizes hex, enforces type hierarchy.
  // Wrapped in try-catch so polish bugs never block the render.
  let polishedContent = styleEnforcedContent;
  try {
    const polishResult = polishOutput(styleEnforcedContent, spec.zones, input.format);
    if (polishResult.actions.length > 0) {
      polishedContent = polishResult.content;
      violations.push(...polishResult.actions.map(a => `polish:${a.zone}:${a.property}: ${a.before} → ${a.after}`));
    }
  } catch {
    // Non-fatal — render with unpolished content
  }

  // ── Stage 7: SVG render (Ultimate — theme decorations + Google Fonts) ─────
  const svgSource = renderUltimateSvg(spec.zones, polishedContent, input.format);
  const dims      = FORMAT_DIMS[input.format] ?? { width: 1080, height: 1080 };

  // ── Stage 8: Format-specific output ───────────────────────────────────
  let buffer:   Buffer;
  let mimeType: PipelineResult["mimeType"];

  if (input.outputFormat === "svg") {
    buffer   = Buffer.from(svgSource, "utf-8");
    mimeType = "image/svg+xml";

  } else if (input.outputFormat === "png") {
    // PNG via sharp — wrap in try-catch so encoding failures fall back to SVG
    try {
      const scale = input.pngScale ?? 1;
      buffer = await sharp(Buffer.from(svgSource))
        .resize(dims.width * scale, dims.height * scale)
        .png({ compressionLevel: 6, effort: 2 })
        .toBuffer();
      mimeType = "image/png";
    } catch (pngErr: any) {
      recoveryLog.push({
        stage: "output",
        issue: `PNG encoding failed: ${pngErr?.message}`,
        action: "Falling back to SVG output",
        severity: "error",
        timestamp: Date.now(),
      });
      violations.push(`self_healing:png: encoding failed — ${pngErr?.message}`);
      logger.warn(
        { jobId: input.jobId, error: pngErr?.message },
        "[self-healing] PNG sharp encoding failed — falling back to SVG",
      );
      buffer   = Buffer.from(svgSource, "utf-8");
      mimeType = "image/svg+xml";
    }

  } else {
    // GIF — wrap broadly so any GIF failure falls back to SVG.
    // Native module unavailability (serverless) gets a specific flag for the API layer.
    try {
      buffer   = await renderGifFromSpec(spec, polishedContent, input, dims);
      mimeType = "image/gif";
    } catch (gifErr: any) {
      const isNativeErr =
        gifErr?.message?.includes("native module") ||
        gifErr?.message?.includes("canvas") ||
        gifErr?.code === "MODULE_NOT_FOUND";

      recoveryLog.push({
        stage: "output",
        issue: `GIF rendering failed: ${gifErr?.message}`,
        action: isNativeErr
          ? "Canvas module unavailable (serverless) — falling back to SVG"
          : "GIF encoding error — falling back to SVG",
        severity: isNativeErr ? "warning" : "error",
        timestamp: Date.now(),
      });
      violations.push(`self_healing:gif: rendering failed — ${gifErr?.message}`);
      logger.warn(
        { jobId: input.jobId, error: gifErr?.message, isNativeErr },
        "[self-healing] GIF rendering failed — falling back to SVG",
      );

      buffer   = Buffer.from(svgSource, "utf-8");
      mimeType = "image/svg+xml";
    }
  }

  // ── Assemble result ────────────────────────────────────────────────────
  ctx.currentStage = "output";
  ctx.output = { buffer, mimeType, svgSource, width: dims.width, height: dims.height };

  const assetId = deriveAssetId(
    input.campaignId, input.format, input.variationIdx, input.outputFormat
  );

  const durationMs = Date.now() - startMs;
  logGenerationEvent(input.format, input.stylePreset, durationMs, true);

  // ── Evaluation signal extraction and ledger recording ──────────────────
  const themeId = buildResult.content._selectedTheme?.id ?? "unknown";
  const evalSignals = extractEvaluationSignals({
    brandScore: styleResult.brandScore,
    hierarchyValid: hierarchyResult.valid,
    violations,
    recoveryActions: recoveryLog,
  });

  // Compute quality scores from the quality gate context if available
  let finalQualityScore = 0;
  let finalDesignQualityScore = 0;
  try {
    if (buildResult.content._selectedTheme) {
      const qs = scoreCandidateQuality(buildResult.content._selectedTheme, buildResult.content as SvgContent);
      finalQualityScore = qs.total;
      const dr = assessDesignQuality(buildResult.content as SvgContent, spec.zones, input.format);
      finalDesignQualityScore = dr.overall;
    }
  } catch {
    // Non-fatal — use zero scores
  }

  // ── Post-generation critic — evaluates whether output matches intent ─────
  let postGenerationVerdict: CriticVerdict | undefined;
  if (agentResult) {
    try {
      postGenerationVerdict = runCriticPostGeneration(
        agentResult.direction,
        agentResult.plan,
        {
          themeId,
          qualityScore: finalQualityScore,
          designQualityScore: finalDesignQualityScore,
          brandScore: styleResult.brandScore,
          hierarchyValid: hierarchyResult.valid,
          violations,
          recoveryCount: recoveryLog.length,
        },
      );
      if (postGenerationVerdict.issues.length > 0) {
        violations.push(...postGenerationVerdict.issues.map(i => `agent:critic: ${i}`));
      }
    } catch {
      // Non-fatal — skip post-generation critique
    }
  }

  // ── Production readiness assessment ─────────────────────────────────────
  let readinessReport: ProductionReadinessReport | undefined;
  try {
    const themeQScore = buildResult.content._selectedTheme
      ? scoreCandidateQuality(buildResult.content._selectedTheme, buildResult.content as SvgContent)
      : undefined;
    const designQReport = buildResult.content._selectedTheme
      ? assessDesignQuality(buildResult.content as SvgContent, spec.zones, input.format)
      : undefined;
    readinessReport = assessProductionReadiness(
      polishedContent,
      spec.zones,
      input.format,
      themeQScore,
      designQReport,
    );
  } catch {
    // Non-fatal — skip readiness assessment
  }

  // Step 33 wiring: build the visual-pattern signature + category id so
  // the ledger entry carries the richer signals the learning layer
  // needs. Inferred category = content bucket the brief landed in;
  // signature = decorationKinds + primary palette + tone bucket so
  // future generations can mine what worked for this category.
  const inferredCategoryPackId = (() => {
    try {
      const text = [input.brief.intent, input.brief.headline, ...(input.brief.keywords ?? [])]
        .filter(Boolean).join(" ");
      return inferCategoryFromText(text) ?? undefined;
    } catch { return undefined; }
  })();

  const patternSignature: VisualPatternSignature | undefined = (() => {
    const theme = (buildResult.content as SvgContent)._selectedTheme;
    if (!theme) return undefined;
    const decorationKinds = Array.from(new Set((theme.decorations ?? []).map(d => d.kind))).sort();
    // Score the theme on demand. Guarded because scoreThemeQuality
    // can theoretically throw on an unexpected theme shape and we
    // don't want a throw here to fail the whole pipeline.
    let assetUsage = 0;
    try { assetUsage = scoreThemeQuality(theme).assetUsage; }
    catch { /* fall through with default 0 */ }
    const assetUsageBand: VisualPatternSignature["assetUsageBand"] =
      assetUsage >= 0.60 ? "high"
      : assetUsage >= 0.30 ? "mid"
      : "low";
    return {
      categoryPackId:   inferredCategoryPackId,
      layoutFamily:     spec.family.id,
      themeId,
      backgroundTreatment: (theme.background as any)?.kind,
      palette: {
        primary:    theme.palette?.primary,
        accent:     theme.palette?.secondary,
        background: theme.palette?.background,
      },
      decorationKinds,
      assetUsageBand,
    };
  })();

  recordGeneration({
    assetId,
    timestamp: Date.now(),
    format: input.format,
    campaignId: input.campaignId,
    themeId,
    layoutFamily: spec.family.id,
    layoutVariation: spec.variation.id,
    qualityScore: finalQualityScore,
    designQualityScore: finalDesignQualityScore,
    brandScore: styleResult.brandScore,
    hierarchyValid: hierarchyResult.valid,
    violationCount: violations.length,
    recoveryCount: recoveryLog.length,
    categoryPackId: inferredCategoryPackId,
    patternSignature,
  });

  // Step 33 wiring: auto-record the pattern when the generation
  // crossed the quality floor. Selection / positive-feedback signals
  // upgrade the weight later through separate entry points. Guarded
  // because recordSuccessfulPattern is best-effort — a throw here
  // shouldn't fail the pipeline.
  if (patternSignature) {
    try { recordSuccessfulPattern(patternSignature, finalQualityScore, "quality"); }
    catch { /* non-fatal */ }
  }

  // Feed the creative intelligence loop with quality signal
  try { recordQualitySignal(input.format, finalQualityScore); } catch { /* non-fatal */ }

  return {
    buffer,
    mimeType,
    svgSource,
    width:    dims.width,
    height:   dims.height,
    fileSize: buffer.length,
    assetId,
    brandScore:     styleResult.brandScore,
    hierarchyValid: hierarchyResult.valid,
    layoutFamily:   spec.family.id,
    layoutVariation:spec.variation.id,
    violations,
    durationMs,
    // Include on-demand asset metadata only if the engine was invoked
    ...(input.assetEngine && onDemandMeta.elements.length > 0
      ? { onDemandAssets: onDemandMeta }
      : {}),
    // Editor element tree — zones + final content for ArkiolEditor handoff
    // Stored in asset.metadata so /api/editor/load can convert without SVG parsing
    editorZones:      spec.zones as unknown[],
    editorSvgContent: styleEnforcedContent as unknown,
    // Self-healing — only populated when recovery actions were taken
    ...(recoveryLog.length > 0 ? {
      recoveryActions: recoveryLog.map(a => ({
        stage: a.stage,
        issue: a.issue,
        action: a.action,
        severity: a.severity,
      })),
    } : {}),
    // Evaluation signals for feedback correlation
    evaluationSignals: {
      qualityScore: finalQualityScore,
      designQualityScore: finalDesignQualityScore,
      themeId,
    },
    // Strict quality verdict — gallery batch filter consumes this directly
    // instead of re-scoring. Rejection and marketplace outcomes are
    // combined into a single structured record.
    ...(buildResult.content._selectedTheme ? (() => {
      const theme   = buildResult.content._selectedTheme!;
      const content = buildResult.content as SvgContent;
      const rej     = (() => {
        try { return evaluateRejection(theme, content); }
        catch { return { accept: true, hardReasons: [], softReasons: [], score: null as any }; }
      })();
      // Penalty-aware rank score — only computed when we have a real
      // quality score from the rejection evaluation. Falls back to the
      // plain quality score for defensive callers.
      const rankBreakdown = rej.score
        ? computeRankScore(rej.score, theme)
        : { total: finalQualityScore, penalties: [] as Array<{ kind: string; amount: number }> };
      const topPenalties = rankBreakdown.penalties
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(p => `${p.kind}:${p.amount.toFixed(2)}`);
      // Populated-section report — classifies the zones that actually
      // carry text into the six SectionKinds so admission logs can
      // show why a template qualified (or was rejected) on structure.
      const populatedZones = (content.textContents ?? [])
        .filter((z: any) => typeof z?.text === "string" && z.text.trim().length > 0)
        .map((z: any) => ({ zoneId: z.zoneId as string, text: z.text as string }));
      const populatedSectionReport = analyzePopulatedSections(populatedZones);
      // Component coverage — read the report the SVG builder stamped on
      // content (`_componentReport`); zero-fallback when the builder
      // fell through to the basic renderer.
      const compReport = (content as any)._componentReport as
        | { assignments: Array<{ kind: string }>; componentCount: number; distinctKinds: string[]; structuredCount: number; hasStructuredComponents: boolean }
        | undefined;
      const contentCov = (content as any)._contentCoverage as
        | { kind: string; populatedItems: number; required: number; satisfiesMinimum: boolean }
        | undefined;
      const contentMap = (content as any)._contentMapping as
        | {
            slots:             Array<{ role: string }>;
            placedRoles:       string[];
            missingRequired:   string[];
            expectedItemCount: number;
            placedItemCount:   number;
            compressed:        boolean;
            underfilled:       boolean;
          }
        | undefined;
      const subject = (content as any)._subjectImage as
        | { slug: string; category: string; realm: string; placement: string; licensed: boolean }
        | undefined;
      const subjectExpected = (content as any)._photoSubjectExpected as boolean | undefined;
      return {
        qualityVerdict: {
          rulesAccepted:       rej.accept,
          marketplaceApproved: marketplaceVerdict?.approved ?? false,
          marketplaceScore:    marketplaceVerdict?.marketplaceScore ?? 0,
          qualityScore:        finalQualityScore,
          rankScore:           rankBreakdown.total,
          rankPenalties:       topPenalties,
          hardReasons:         rej.hardReasons,
          softReasons:         rej.softReasons,
          failedCriteria:      marketplaceVerdict?.failedCriteria ?? [],
          themeId,
          templateType:        (buildResult.content as any)._templateType as TemplateType | undefined,
          sections:            populatedSectionReport.populatedSections,
          sectionCount:        populatedSectionReport.count,
          sectionAnchorCount:  populatedSectionReport.anchorCount,
          sectionsSatisfied:   populatedSectionReport.satisfiesMinimum,
          componentKinds:           compReport?.distinctKinds ?? [],
          componentCount:           compReport?.componentCount ?? 0,
          structuredComponentCount: compReport?.structuredCount ?? 0,
          componentsSatisfied:      compReport?.hasStructuredComponents ?? false,
          contentKind:              contentCov?.kind,
          contentItems:             contentCov?.populatedItems ?? 0,
          contentItemsRequired:     contentCov?.required ?? 0,
          contentSatisfied:         contentCov?.satisfiesMinimum ?? true,
          contentSource:            (() => {
            const s = (buildResult.content as any)._structuredContent as { meta?: { source?: string } } | undefined;
            if (!s?.meta) return undefined;
            return s.meta.source === "openai" ? "openai_structured" as const
                 : s.meta.source === "fallback" ? "fallback" as const
                 : "legacy_zone_text" as const;
          })(),
          structuredItemCount:      ((buildResult.content as any)._structuredContent?.items?.length ?? 0),
          mappingExpectedItems:     contentMap?.expectedItemCount ?? 0,
          mappingPlacedItems:       contentMap?.placedItemCount   ?? 0,
          mappingMissingRoles:      contentMap?.missingRequired   ?? [],
          mappingUnderfilled:       contentMap?.underfilled       ?? false,
          mappingCompressed:        contentMap?.compressed        ?? false,
          mappingSlotCount:         contentMap?.slots?.length     ?? 0,
          subjectImageSlug:         subject?.slug,
          subjectImageCategory:     subject?.category,
          subjectImageRealm:        subject?.realm,
          subjectImagePlacement:    subject?.placement,
          subjectImageLicensed:     subject?.licensed,
          subjectImageExpected:     subjectExpected ?? false,
        },
      };
    })() : {}),
    // Step 39: pack-style snapshot so the multi-output coordinator can
    // extract a PackAnchor and lock sibling variations to the same look.
    ...(buildResult.content._selectedTheme ? {
      packStyleSnapshot: {
        primary:      buildResult.content._selectedTheme.palette.primary,
        accent:       buildResult.content._selectedTheme.palette.secondary,
        surface:      buildResult.content._selectedTheme.palette.background,
        ink:          buildResult.content._selectedTheme.palette.text,
        fontDisplay:  buildResult.content._selectedTheme.typography.display,
        fontBody:     buildResult.content._selectedTheme.typography.body,
        cornerRadius: buildResult.content._selectedTheme.ctaStyle.borderRadius,
        ctaShadow:    buildResult.content._selectedTheme.ctaStyle.shadow === true,
        firstTone:    buildResult.content._selectedTheme.tones?.[0],
      },
    } : {}),
    // Agent orchestration metadata — design decisions from the thinking layer
    ...(agentResult ? {
      agentOrchestration: {
        direction: agentResult.direction,
        plan: agentResult.plan,
        preFlightVerdict: agentResult.preFlightVerdict,
        postGenerationVerdict,
        adjustmentsApplied: agentResult.adjustmentsApplied,
      },
    } : {}),
    // Production readiness verdict
    ...(readinessReport ? {
      productionReadiness: {
        verdict: readinessReport.verdict,
        overallScore: readinessReport.overallScore,
        blockers: readinessReport.blockers,
        warnings: readinessReport.warnings,
      },
    } : {}),
  };
}

// ── GIF pipeline — uses resolved zones, not ad-hoc data ───────────────────────
async function renderGifFromSpec(
  spec:    ReturnType<typeof resolveLayoutSpec>,
  content: any,
  input:   PipelineInput,
  dims:    { width: number; height: number }
): Promise<Buffer> {
  const gifStyle = input.gifStyle ?? "kinetic_text";
  const fps      = input.gifFps     ?? 12;
  const quality  = input.gifQuality ?? 10;

  // Extract zone-resolved text elements for GIF frames
  // Key insight: we use spec.zones for geometry, content.textContents for text
  const bgColor   = content.backgroundColor ?? "#f8f7f4";
  const gradColors = content.backgroundGradient?.type !== "none"
    ? content.backgroundGradient?.colors ?? [bgColor]
    : [bgColor];

  // Resolve accent color from theme (highlight > primary)
  const themeAccent = (content._selectedTheme as any)?.palette?.highlight
    ?? (content._selectedTheme as any)?.palette?.primary
    ?? content.accentShape?.color
    ?? "#4f6ef7";

  // Build frame descriptors from zones and content (same data as SVG)
  const textMap = new Map<string, any>(
    (content.textContents ?? []).map((t: any) => [t.zoneId, t])
  );

  const headline = textMap.get("headline");
  const subhead  = textMap.get("subhead");
  const cta      = textMap.get("cta");

  // Resolve zone geometry to absolute pixels
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);
  const headlineZone = spec.zones.find(z => z.id === "headline");
  const subheadZone  = spec.zones.find(z => z.id === "subhead");
  const ctaZone      = spec.zones.find(z => z.id === "cta");

  // Build ZoneTextDesc helpers
  const makeHeadlineDesc = () => headlineZone && headline ? {
    text:       headline.text,
    color:      headline.color,
    fontSize:   headline.fontSize,
    fontFamily: headline.fontFamily,
    x:          headlineZone.alignH === "center"
                  ? px(headlineZone.x, dims.width) + px(headlineZone.width, dims.width) / 2
                  : px(headlineZone.x, dims.width),
    y:          px(headlineZone.y, dims.height) + headline.fontSize,
    maxWidth:   px(headlineZone.width, dims.width),
    weight:     (headline.weight >= 700 ? "bold" : "normal") as "bold" | "normal",
    align:      (headlineZone.alignH === "center" ? "center" : "left") as "left" | "center" | "right",
  } : undefined;

  const makeSubheadDesc = () => subheadZone && subhead ? {
    text:       subhead.text,
    color:      subhead.color,
    fontSize:   subhead.fontSize,
    fontFamily: subhead.fontFamily,
    x:          subheadZone.alignH === "center"
                  ? px(subheadZone.x, dims.width) + px(subheadZone.width, dims.width) / 2
                  : px(subheadZone.x, dims.width),
    y:          px(subheadZone.y, dims.height) + subhead.fontSize,
    maxWidth:   px(subheadZone.width, dims.width),
    weight:     "normal" as "normal",
    align:      (subheadZone.alignH === "center" ? "center" : "left") as "left" | "center" | "right",
  } : undefined;

  let frames: GifFrame[];

  if (gifStyle === "kinetic_text" && headline && headlineZone) {
    frames = buildKineticTextFrames({
      width:  dims.width,
      height: dims.height,
      bgColor: gradColors[0] ?? bgColor,
      gradientColors: gradColors.length > 1 ? gradColors as [string, ...string[]] : undefined,
      headline: makeHeadlineDesc()!,
      subhead:  makeSubheadDesc(),
      cta: cta && ctaZone && content.ctaStyle ? {
        text:         cta.text,
        color:        content.ctaStyle.textColor ?? "#ffffff",
        bgColor:      content.ctaStyle.backgroundColor ?? themeAccent,
        fontSize:     cta.fontSize,
        fontFamily:   cta.fontFamily,
        x:            px(ctaZone.x, dims.width),
        y:            px(ctaZone.y, dims.height),
        width:        px(ctaZone.width, dims.width),
        height:       px(ctaZone.height, dims.height),
        borderRadius: content.ctaStyle.borderRadius ?? 50,
      } : undefined,
      frameCount:  28,
      fps,
      accentColor: themeAccent,
    });
  } else if (gifStyle === "fade") {
    frames = buildFadeFrames({
      width: dims.width, height: dims.height,
      bgColor, gradientColors: gradColors.length > 1 ? gradColors as [string, ...string[]] : undefined,
      fontFamily:  headline?.fontFamily ?? subhead?.fontFamily ?? "Montserrat",
      accentColor: themeAccent,
      slides: [
        ...(headline ? [{ headline: headline.text, headlineColor: headline.color, fontSize: headline.fontSize }] : []),
        ...(subhead  ? [{ headline: subhead.text,  headlineColor: subhead.color,  fontSize: subhead.fontSize, sub: "" }] : []),
        ...(cta      ? [{ headline: cta.text,      headlineColor: cta.color,      fontSize: cta.fontSize      }] : []),
      ].filter(s => s.headline),
      framesPerSlide: 20,
    });
  } else {
    // pulse_cta — with reveal fallback
    if (cta && ctaZone && content.ctaStyle) {
      frames = buildPulseCtaFrames({
        width: dims.width, height: dims.height, bgColor,
        gradientColors: gradColors.length > 1 ? gradColors as [string, ...string[]] : undefined,
        fontFamily:  headline?.fontFamily ?? cta?.fontFamily ?? "Montserrat",
        accentColor: themeAccent,
        headline: headline ? { text: headline.text, color: headline.color, fontSize: headline.fontSize } : undefined,
        cta: {
          text:    cta.text,
          color:   content.ctaStyle.textColor,
          bgColor: content.ctaStyle.backgroundColor,
          x:       px(ctaZone.x, dims.width),
          y:       px(ctaZone.y, dims.height),
          w:       px(ctaZone.width, dims.width),
          h:       px(ctaZone.height, dims.height),
        },
        frameCount: 28,
      });
    } else if (headline && headlineZone) {
      // Reveal animation as premium fallback
      frames = buildRevealFrames({
        width: dims.width, height: dims.height, bgColor,
        gradientColors: gradColors.length > 1 ? gradColors as [string, ...string[]] : undefined,
        headline:    makeHeadlineDesc()!,
        subhead:     makeSubheadDesc(),
        accentColor: themeAccent,
        frameCount:  26,
      });
    } else {
      frames = buildKineticTextFrames({
        width: dims.width, height: dims.height, bgColor,
        headline: { text: headline?.text ?? ".", color: "#ffffff", fontSize: 48, fontFamily: headline?.fontFamily ?? "Montserrat", x: dims.width / 2, y: dims.height * 0.42, maxWidth: dims.width * 0.82, weight: "bold", align: "center" },
        frameCount: 22, fps, accentColor: themeAccent,
      });
    }
  }

  return renderGif(frames, {
    width:   dims.width,
    height:  dims.height,
    repeat:  0,
    quality,
    fps,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getBriefLength(brief: BriefAnalysis): "short" | "medium" | "long" {
  const totalChars = [
    brief.headline,
    brief.subhead ?? "",
    brief.body ?? "",
    brief.cta ?? "",
  ].join("").length;

  if (totalChars < 80)  return "short";
  if (totalChars < 200) return "medium";
  return "long";
}
