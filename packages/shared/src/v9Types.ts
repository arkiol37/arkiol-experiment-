// packages/shared/src/v9Types.ts
// V9 Shared Types — exported from @arkiol/shared for cross-package use.
// ─────────────────────────────────────────────────────────────────────────────
// Keeps the arkiol-core engine types accessible to worker packages,
// API packages, and any third-party integrators without circular dependencies.

// ── Job Priority ──────────────────────────────────────────────────────────────
export type JobPriority = "critical" | "high" | "normal" | "low";

// ── Provider Names ────────────────────────────────────────────────────────────
export type ProviderName = "openai" | "stability" | "replicate" | "local" | "fallback_svg";

// ── Job Outcome ───────────────────────────────────────────────────────────────
export type JobOutcome = "success" | "retry" | "permanent_failure" | "skipped" | "timeout";

// ── Render Job Spec (cross-package subset) ────────────────────────────────────
export interface RenderJobSpecBase {
  jobId:         string;
  orgId:         string;
  userId:        string;
  format:        string;
  priority:      JobPriority;
  maxAttempts:   number;
  attempts:      number;
  timeoutMs:     number;
  maxBudgetUsd:  number;
  isCampaignJob: boolean;
  campaignId?:   string;
  createdAt:     string;   // ISO timestamp
}

// ── Queue Telemetry Record ─────────────────────────────────────────────────────
export interface QueueTelemetryRecord {
  jobId:      string;
  orgId:      string;
  priority:   JobPriority;
  outcome:    JobOutcome;
  durationMs: number;
  provider:   ProviderName;
  costUsd:    number;
  attempts:   number;
  timestamp?: string;
}

// ── Platform Compliance Score (cross-package) ─────────────────────────────────
export interface PlatformComplianceScoreBase {
  overall:         number;   // 0–1
  textLegibility:  number;   // 0–1
  compositionFit:  number;   // 0–1
  safeZoneRespect: number;   // 0–1
  hookEffectiveness: number; // 0–1
  violationCount:  number;
}

// ── Campaign Objective ────────────────────────────────────────────────────────
export type CampaignObjective =
  | "awareness"
  | "engagement"
  | "conversion"
  | "retention"
  | "announcement";

// ── Campaign Tone ─────────────────────────────────────────────────────────────
export type CampaignTone =
  | "urgent"
  | "inspirational"
  | "educational"
  | "playful"
  | "premium"
  | "authoritative"
  | "friendly"
  | "mysterious";

// ── Format Role ───────────────────────────────────────────────────────────────
export type CampaignFormatRole = "hero" | "supporting" | "cta" | "awareness";

// ── Feedback Signal Types ─────────────────────────────────────────────────────
export type FeedbackSignalType =
  | "selected"
  | "exported"
  | "regenerated"
  | "dismissed"
  | "time_spent_high"
  | "time_spent_low";

// ── Confidence Tier ───────────────────────────────────────────────────────────
export type ConfidenceTier = "high_confidence" | "experimental" | "speculative";

// ── Cost Accumulation ─────────────────────────────────────────────────────────
export interface CostAccumulationBase {
  orgId:           string;
  jobId:           string;
  provider:        ProviderName;
  costUsd:         number;
  idempotencyKey:  string;
  timestamp:       string;
}

// ── Spend Budget Status ────────────────────────────────────────────────────────
export interface OrgBudgetStatus {
  orgId:               string;
  currentHourSpendUsd: number;
  currentDaySpendUsd:  number;
  hourlyLimitUsd:      number;
  dailyLimitUsd:       number;
  withinBudget:        boolean;
  blockReason?:        string;
}

// ── Asset Industry ────────────────────────────────────────────────────────────
export type AssetIndustry =
  | "tech"
  | "fitness"
  | "food"
  | "fashion"
  | "finance"
  | "education"
  | "entertainment"
  | "generic";

// ── Novelty Archive Entry ─────────────────────────────────────────────────────
export interface NoveltyArchiveEntryBase {
  candidateId:   string;
  format:        string;
  featureVector: number[];  // 12-dimensional
}

// ── V9 DB record IDs ──────────────────────────────────────────────────────────
// These are the primary key shapes for new v9 tables.
export interface ExplorationPriorsId {
  orgId:    string;
  brandId?: string;
}

export interface CampaignPlanId {
  campaignId: string;
}
