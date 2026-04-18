// src/engines/multi-output/coordinator.ts
//
// Multi-Output Coordinator — orchestrates generation of a coherent set of
// designs from a single prompt or campaign plan. Each output is rendered
// independently via the existing pipeline, but all share a style anchor
// (palette, typography, tone) and narrative thread.
//
// The coordinator:
//   1. Accepts a campaign plan (or builds one from a prompt)
//   2. Extracts a style anchor for visual consistency
//   3. Converts each format into a pipeline input
//   4. Runs renders sequentially (or with bounded concurrency)
//   5. Validates cross-output coherence
//   6. Returns an aggregated result with per-format outputs

import {
  buildCampaignPlan,
  campaignFormatToGenerationPayload,
  type CampaignPlan,
  type CampaignFormatPlan,
  type DirectorInput,
} from "../campaign/creative-director";
import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { PipelineInput, PipelineResult } from "../render/pipeline";
import type { PersonalizationContext } from "../personalization/dna-applicator";
import type { CoherenceReport } from "../campaign/campaign-coherence";
import {
  extractStyleAnchor,
  anchorToBrand,
  deriveVariationIndex,
  checkOutputConsistency,
  type StyleAnchor,
  type ConsistencyCheck,
} from "./style-anchor";

// ── Multi-output request ───────────────────────────────────────────────────

export interface MultiOutputRequest {
  prompt: string;
  formats?: string[];
  brandId?: string;
  brand?: {
    primaryColor: string;
    secondaryColor: string;
    fontDisplay: string;
    fontBody: string;
    voiceAttribs?: Record<string, number>;
  };
  seed?: string;
  outputFormat?: "svg" | "png" | "gif";
  personalization?: PersonalizationContext;
  concurrency?: number;
  briefOverride?: BriefAnalysis;
  assetEngine?: PipelineInput["assetEngine"];
}

// ── Per-format render result ───────────────────────────────────────────────

export interface FormatRenderResult {
  format: string;
  role: string;
  platform: string;
  narrativeBeat?: string;
  pipelineInput: PipelineInput;
  result?: PipelineResult;
  error?: string;
  durationMs: number;
}

// ── Aggregated multi-output result ─────────────────────────────────────────

export interface MultiOutputResult {
  campaignId: string;
  prompt: string;
  styleAnchor: StyleAnchor;
  plan: CampaignPlan;
  renders: FormatRenderResult[];
  coherenceReport?: CoherenceReport;
  consistencyChecks: ConsistencyCheck[];

  totalFormats: number;
  successCount: number;
  failCount: number;
  totalDurationMs: number;
  totalCredits: number;

  readinessBreakdown: {
    ready: number;
    needsReview: number;
    reject: number;
  };
}

// ── Build pipeline inputs from campaign plan ───────────────────────────────
// This is the core translation layer — converts campaign format plans into
// concrete PipelineInput objects that the render pipeline can execute.

export function buildMultiOutputPipelineInputs(
  plan: CampaignPlan,
  request: MultiOutputRequest,
  renderFn?: (input: PipelineInput) => Promise<PipelineResult>,
): PipelineInput[] {
  const anchor = extractStyleAnchor(plan);
  const anchorBrand = request.brand ?? anchorToBrand(anchor);
  const outputFormat = request.outputFormat ?? "png";

  const inputs: PipelineInput[] = [];

  for (let i = 0; i < plan.formats.length; i++) {
    const formatPlan = plan.formats[i];
    const variationIdx = deriveVariationIndex(plan.seed, i);

    const brief = buildBriefFromFormatPlan(plan, formatPlan, request.briefOverride);

    const pipelineInput: PipelineInput = {
      jobId: `${plan.campaignId}_${formatPlan.format}_${i}`,
      format: formatPlan.format,
      stylePreset: formatPlan.presetId,
      variationIdx,
      campaignId: plan.campaignId,
      brief,
      brand: anchorBrand,
      outputFormat: formatPlan.includeMotion ? "gif" : outputFormat,
      gifStyle: formatPlan.includeMotion ? "kinetic_text" : undefined,
      personalization: request.personalization,
      assetEngine: request.assetEngine,
    };

    inputs.push(pipelineInput);
  }

  return inputs;
}

// ── Orchestrate multi-output generation ────────────────────────────────────

export async function generateMultiOutput(
  request: MultiOutputRequest,
  renderFn: (input: PipelineInput) => Promise<PipelineResult>,
): Promise<MultiOutputResult> {
  const startTime = Date.now();

  // Step 1: Build campaign plan
  const directorInput: DirectorInput = {
    prompt: request.prompt,
    brandId: request.brandId,
    brandPrimaryColor: request.brand?.primaryColor,
    requestedFormats: request.formats,
    seed: request.seed,
  };

  const plan = buildCampaignPlan(directorInput);
  const anchor = extractStyleAnchor(plan);
  const pipelineInputs = buildMultiOutputPipelineInputs(plan, request, renderFn);

  // Step 2: Execute renders with bounded concurrency
  const concurrency = Math.max(1, Math.min(request.concurrency ?? 2, 4));
  const renders: FormatRenderResult[] = [];
  let anchorThemeId: string | undefined;

  const chunks = chunkArray(
    plan.formats.map((fp, i) => ({ formatPlan: fp, input: pipelineInputs[i], index: i })),
    concurrency,
  );

  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ formatPlan, input, index }) => {
        const renderStart = Date.now();
        try {
          const result = await renderFn(input);

          // Capture the first successful theme as the anchor reference
          if (!anchorThemeId && result.evaluationSignals?.themeId) {
            anchorThemeId = result.evaluationSignals.themeId;
          }

          return {
            format: formatPlan.format,
            role: formatPlan.role,
            platform: formatPlan.platform,
            narrativeBeat: formatPlan.narrativeBeat,
            pipelineInput: input,
            result,
            durationMs: Date.now() - renderStart,
          } as FormatRenderResult;
        } catch (err: any) {
          return {
            format: formatPlan.format,
            role: formatPlan.role,
            platform: formatPlan.platform,
            narrativeBeat: formatPlan.narrativeBeat,
            pipelineInput: input,
            error: err.message ?? "Unknown render error",
            durationMs: Date.now() - renderStart,
          } as FormatRenderResult;
        }
      }),
    );

    for (const settled of chunkResults) {
      if (settled.status === "fulfilled") {
        renders.push(settled.value);
      }
    }
  }

  // Step 3: Consistency checks across outputs
  const anchorBrand = request.brand ?? anchorToBrand(anchor);
  const consistencyChecks: ConsistencyCheck[] = renders
    .filter(r => r.result)
    .map(r => {
      const outputThemeId = r.result?.evaluationSignals?.themeId;
      const outputBrand = r.pipelineInput.brand ?? anchorBrand;
      return checkOutputConsistency(
        anchorThemeId,
        outputThemeId,
        anchorBrand,
        outputBrand,
      );
    });

  // Step 4: Aggregate results
  const successCount = renders.filter(r => r.result && !r.error).length;
  const failCount = renders.filter(r => r.error).length;
  const totalCredits = renders.reduce((sum, r) => {
    return sum + (r.result?.onDemandAssets?.totalCreditCost ?? 0);
  }, plan.estimatedCredits);

  const readinessBreakdown = { ready: 0, needsReview: 0, reject: 0 };
  for (const r of renders) {
    const verdict = r.result?.productionReadiness?.verdict;
    if (verdict === "ready") readinessBreakdown.ready++;
    else if (verdict === "needs_review") readinessBreakdown.needsReview++;
    else if (verdict === "reject") readinessBreakdown.reject++;
  }

  return {
    campaignId: plan.campaignId,
    prompt: request.prompt,
    styleAnchor: anchor,
    plan,
    renders,
    coherenceReport: plan.coherenceReport,
    consistencyChecks,
    totalFormats: plan.formats.length,
    successCount,
    failCount,
    totalDurationMs: Date.now() - startTime,
    totalCredits,
    readinessBreakdown,
  };
}

// ── Generate variations of a single format ─────────────────────────────────
// Produces N visually distinct outputs for the same format, sharing a style
// anchor but varying layout, theme, and composition.

export interface VariationRequest {
  prompt: string;
  format: string;
  count: number;
  brand?: MultiOutputRequest["brand"];
  personalization?: PersonalizationContext;
  outputFormat?: "svg" | "png" | "gif";
  assetEngine?: PipelineInput["assetEngine"];
}

export interface VariationResult {
  format: string;
  renders: Array<{
    variationIndex: number;
    pipelineInput: PipelineInput;
    result?: PipelineResult;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
  bestIndex: number;
}

export async function generateVariations(
  request: VariationRequest,
  renderFn: (input: PipelineInput) => Promise<PipelineResult>,
  briefFn: (prompt: string) => BriefAnalysis | Promise<BriefAnalysis>,
): Promise<VariationResult> {
  const startTime = Date.now();
  const count = Math.max(1, Math.min(request.count, 6));
  const brief = await briefFn(request.prompt);
  const outputFormat = request.outputFormat ?? "png";

  const renders: VariationResult["renders"] = [];
  let bestScore = -1;
  let bestIndex = 0;

  for (let i = 0; i < count; i++) {
    const renderStart = Date.now();
    const input: PipelineInput = {
      jobId: `var_${request.format}_${i}`,
      format: request.format,
      stylePreset: "auto",
      variationIdx: i * 7919 + 1,
      campaignId: `variation_${Date.now()}`,
      brief,
      brand: request.brand,
      outputFormat,
      personalization: request.personalization,
      assetEngine: request.assetEngine,
    };

    try {
      const result = await renderFn(input);
      const score = result.productionReadiness?.overallScore ?? result.evaluationSignals?.qualityScore ?? 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      renders.push({ variationIndex: i, pipelineInput: input, result, durationMs: Date.now() - renderStart });
    } catch (err: any) {
      renders.push({ variationIndex: i, pipelineInput: input, error: err.message, durationMs: Date.now() - renderStart });
    }
  }

  return {
    format: request.format,
    renders,
    totalDurationMs: Date.now() - startTime,
    bestIndex,
  };
}

// ── Build brief from campaign format plan ──────────────────────────────────

function buildBriefFromFormatPlan(
  plan: CampaignPlan,
  formatPlan: CampaignFormatPlan,
  briefOverride?: BriefAnalysis,
): BriefAnalysis {
  if (briefOverride) {
    return {
      ...briefOverride,
      headline: formatPlan.headline,
      subhead: formatPlan.subMessage || briefOverride.subhead,
      cta: formatPlan.ctaText || briefOverride.cta,
    };
  }

  const toneMap: Record<string, BriefAnalysis["tone"]> = {
    urgent: "urgent",
    inspirational: "warm",
    educational: "professional",
    playful: "playful",
    premium: "luxury",
    authoritative: "professional",
    friendly: "warm",
    mysterious: "bold",
  };

  const colorMoodMap: Record<string, BriefAnalysis["colorMood"]> = {
    urgent: "vibrant",
    inspirational: "warm",
    educational: "light",
    playful: "vibrant",
    premium: "dark",
    authoritative: "cool",
    friendly: "warm",
    mysterious: "dark",
  };

  return {
    intent: plan.prompt,
    audience: "general",
    tone: toneMap[plan.identity.tone] ?? "professional",
    keywords: plan.prompt.split(/\s+/).filter(w => w.length > 3).slice(0, 8),
    colorMood: colorMoodMap[plan.identity.tone] ?? "vibrant",
    imageStyle: "abstract",
    headline: formatPlan.headline,
    subhead: formatPlan.subMessage || undefined,
    cta: formatPlan.ctaText || undefined,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
