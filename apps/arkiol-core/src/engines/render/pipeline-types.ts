// src/engines/render/pipeline-types.ts
//
// Structured data schemas for the render pipeline.
// Each stage produces a typed result object. The PipelineContext accumulates
// results as data flows: prompt → intent → layout → style → assets → render → output.
// No stage reads loose variables from another — all inter-stage data is structured.

import type { BriefAnalysis } from "../ai/brief-analyzer";
import type { LayoutSpec } from "../layout/authority";
import type { AdaptiveLayoutResult } from "../layout/adaptive-layout";
import type { DensityAnalysis } from "../layout/density";
import type { StyleEnforcementResult } from "../layout/style-enforcer";
import type { Zone } from "../layout/families";
import type { CompositionPlan } from "../assets/asset-selector";
import type { SvgContent, BuildResult } from "./svg-builder-ultimate";
import type { HierarchyResult } from "../hierarchy/enforcer";
import type { CandidateQualityScore } from "../evaluation/candidate-quality";
import type { DesignQualityReport } from "../evaluation/candidate-refinement";
import type { PipelineInput, InjectedAssetMap } from "./pipeline";
import type { AgentOrchestrationResult } from "../agents/design-agents";

// ── Pipeline stage names ────────────────────────────────────────────────────

export type PipelineStage =
  | "init"
  | "layout"
  | "density"
  | "composition"
  | "assets"
  | "render"
  | "quality_gate"
  | "hierarchy"
  | "style_enforcement"
  | "output";

// ── Enriched brief — BriefAnalysis extended with pipeline-internal markers ──
// Replaces the previous `as any` cast when injecting density/composition/assets.

export interface EnrichedBrief extends BriefAnalysis {
  _densitySuggestions: string[];
  _compositionFragment: string;
  _injectedAssets: InjectedAssetMap;
}

// ── Guard check result — typed return from kill-switch / spend-guard ────────

export interface GuardCheckResult {
  allowed: boolean;
  reason: string;
  code?: string;
}

// ── Layout stage result ─────────────────────────────────────────────────────

export interface LayoutStageResult {
  rawSpec: LayoutSpec;
  adapted: AdaptiveLayoutResult;
  spec: LayoutSpec;
}

// ── Density stage result ────────────────────────────────────────────────────

export interface DensityStageResult {
  analysis: DensityAnalysis;
}

// ── Composition stage result ────────────────────────────────────────────────

export interface CompositionStageResult {
  plan: CompositionPlan;
  contractViolations: string[];
}

// ── Asset resolution result ─────────────────────────────────────────────────

export interface ResolvedAsset {
  elementId: string;
  elementType: string;
  cdnUrl: string;
  source: string;
  creditCost: number;
  cacheHit: boolean;
  durationMs: number;
}

export interface AssetStageResult {
  injectedAssets: InjectedAssetMap;
  resolvedAssets: ResolvedAsset[];
  totalCreditCost: number;
  totalProviderCostUsd: number;
  cacheHits: number;
  libraryHits: number;
  aiGenerations: number;
}

// ── Render stage result ─────────────────────────────────────────────────────

export interface RenderStageResult {
  content: SvgContent;
  violations: string[];
}

// ── Quality gate result ─────────────────────────────────────────────────────

export interface QualityGateResult {
  themeScore?: CandidateQualityScore;
  designReport?: DesignQualityReport;
  combinedScore: number;
  refined: boolean;
  retried: boolean;
}

// ── Hierarchy stage result ──────────────────────────────────────────────────

export interface HierarchyStageResult {
  result: HierarchyResult;
  content: SvgContent;
}

// ── Style enforcement stage result ──────────────────────────────────────────

export interface StyleStageResult {
  result: StyleEnforcementResult;
  content: SvgContent;
}

// ── Output stage result ─────────────────────────────────────────────────────

export interface OutputStageResult {
  buffer: Buffer;
  mimeType: "image/svg+xml" | "image/png" | "image/gif";
  svgSource: string;
  width: number;
  height: number;
}

// ── Pipeline context — structured accumulator for all stage results ─────────
// Created at pipeline start, populated as each stage completes.
// Replaces loose local variables with a single typed state object.

export interface PipelineContext {
  input: PipelineInput;
  startedAt: number;
  currentStage: PipelineStage;

  agentOrchestration?: AgentOrchestrationResult;
  layout?: LayoutStageResult;
  density?: DensityStageResult;
  composition?: CompositionStageResult;
  assets?: AssetStageResult;
  render?: RenderStageResult;
  qualityGate?: QualityGateResult;
  hierarchy?: HierarchyStageResult;
  styleEnforcement?: StyleStageResult;
  output?: OutputStageResult;

  violations: string[];
}

export function createPipelineContext(input: PipelineInput): PipelineContext {
  return {
    input,
    startedAt: Date.now(),
    currentStage: "init",
    violations: [],
  };
}
