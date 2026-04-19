// src/engines/render/self-healing.ts
//
// Self-healing and failure recovery for the render pipeline.
// Provides stage-level error boundaries, zone geometry healing,
// content integrity checks, and fallback SVG generation so the
// pipeline delivers a usable result even under partial failures.

import type { Zone } from "../layout/families";
import type { SvgContent } from "./svg-builder-ultimate";
import type { PipelineInput, PipelineResult, InjectedAssetMap } from "./pipeline";
import type { PipelineStage } from "./pipeline-types";
import { FORMAT_DIMS } from "../../lib/types";
import { logger } from "../../lib/logger";
import { createHash } from "crypto";

// ── Recovery action tracking ────────────────────────────────────────────────

export interface RecoveryAction {
  stage: string;
  issue: string;
  action: string;
  severity: "warning" | "error" | "critical";
  timestamp: number;
  // Step 32: retry iteration that produced this action (1-indexed). Useful
  // when auditing how many times a stage was attempted before succeeding
  // (or giving up).
  attempt?: number;
}

// ── Safe stage runner ───────────────────────────────────────────────────────

export async function runSafeStage<T>(
  stageName: string,
  fn: () => T | Promise<T>,
  fallback: T | (() => T),
  recoveryLog: RecoveryAction[],
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const issue = err?.message ?? "unknown error";
    const action = `Recovered with fallback for stage "${stageName}"`;

    recoveryLog.push({
      stage: stageName,
      issue,
      action,
      severity: "error",
      timestamp: Date.now(),
    });

    logger.warn(
      { stage: stageName, error: issue },
      `[self-healing] Stage "${stageName}" failed — applying fallback`,
    );

    return typeof fallback === "function" ? (fallback as () => T)() : fallback;
  }
}

// ── Zone geometry healing ───────────────────────────────────────────────────

export function healZoneGeometry(
  zones: Zone[],
  canvasWidth: number,
  canvasHeight: number,
): { zones: Zone[]; actions: RecoveryAction[] } {
  const actions: RecoveryAction[] = [];
  const healed = zones.map(z => {
    const fixed = { ...z };
    let changed = false;

    if (fixed.width <= 0) {
      fixed.width = Math.min(200, canvasWidth * 0.4);
      changed = true;
    }
    if (fixed.height <= 0) {
      fixed.height = Math.min(60, canvasHeight * 0.1);
      changed = true;
    }

    if (fixed.x < 0) {
      fixed.x = 0;
      changed = true;
    }
    if (fixed.y < 0) {
      fixed.y = 0;
      changed = true;
    }

    if (fixed.x + fixed.width > canvasWidth) {
      fixed.width = Math.max(50, canvasWidth - fixed.x);
      changed = true;
    }
    if (fixed.y + fixed.height > canvasHeight) {
      fixed.height = Math.max(30, canvasHeight - fixed.y);
      changed = true;
    }

    if (changed) {
      actions.push({
        stage: "layout",
        issue: `Zone "${z.id}" had invalid geometry (x=${z.x}, y=${z.y}, w=${z.width}, h=${z.height})`,
        action: `Clamped to canvas bounds (x=${fixed.x}, y=${fixed.y}, w=${fixed.width}, h=${fixed.height})`,
        severity: "warning",
        timestamp: Date.now(),
      });
    }

    return fixed;
  });

  return { zones: healed, actions };
}

// ── Content integrity healing ───────────────────────────────────────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function healContent(
  content: SvgContent,
  fallbackBg: string,
): { content: SvgContent; actions: RecoveryAction[] } {
  const actions: RecoveryAction[] = [];
  const fixed = { ...content };

  if (!fixed.backgroundColor || !HEX_COLOR_RE.test(fixed.backgroundColor)) {
    actions.push({
      stage: "render",
      issue: `Invalid backgroundColor: "${fixed.backgroundColor}"`,
      action: `Replaced with fallback "${fallbackBg}"`,
      severity: "warning",
      timestamp: Date.now(),
    });
    fixed.backgroundColor = fallbackBg;
  }

  if (!fixed.textContents || fixed.textContents.length === 0) {
    actions.push({
      stage: "render",
      issue: "No text contents in rendered output",
      action: "Content will appear empty — downstream stages may add fallback text",
      severity: "error",
      timestamp: Date.now(),
    });
  }

  if (fixed.textContents) {
    fixed.textContents = fixed.textContents.map(tc => {
      const t = { ...tc };
      if (!t.color || !HEX_COLOR_RE.test(t.color)) {
        actions.push({
          stage: "render",
          issue: `Zone "${t.zoneId}" has invalid text color: "${t.color}"`,
          action: 'Replaced with "#000000"',
          severity: "warning",
          timestamp: Date.now(),
        });
        t.color = "#000000";
      }
      if (typeof t.fontSize !== "number" || t.fontSize <= 0 || !isFinite(t.fontSize)) {
        actions.push({
          stage: "render",
          issue: `Zone "${t.zoneId}" has invalid fontSize: ${t.fontSize}`,
          action: "Replaced with 16px",
          severity: "warning",
          timestamp: Date.now(),
        });
        t.fontSize = 16;
      }
      return t;
    });
  }

  return { content: fixed, actions };
}

// ── Safety-net SVG ──────────────────────────────────────────────────────────

export function buildSafetyNetSvg(
  width: number,
  height: number,
  headline: string,
  bgColor = "#f8f7f4",
): string {
  const escapedHeadline = headline
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const fontSize = Math.max(16, Math.min(48, width * 0.04));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect width="${width}" height="${height}" fill="${bgColor}" />`,
    `  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central"`,
    `    font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="700"`,
    `    fill="#333333">${escapedHeadline}</text>`,
    `</svg>`,
  ].join("\n");
}

// ── Degraded pipeline result ────────────────────────────────────────────────

// ── Retry with exponential backoff (Step 32) ─────────────────────────────
// Wraps any async operation in a bounded retry loop. Each attempt logs a
// RecoveryAction before the next try so the audit trail captures the
// full recovery path. Use for anything that can be *transiently* flaky:
// AI calls, asset fetches, remote image loads.
//
// Returns the resolved value on first success; throws the last error if
// every attempt failed. A custom `shouldRetry(err)` lets the caller skip
// retrying on permanent errors (kill switch, validation failure, etc.).

export interface RetryOptions {
  stage:           string;
  maxAttempts?:    number;           // default 3
  initialDelayMs?: number;           // default 200
  maxDelayMs?:     number;           // default 2000
  shouldRetry?:    (err: unknown) => boolean;
  recoveryLog?:    RecoveryAction[];
}

export async function retryWithBackoff<T>(
  fn:   (attempt: number) => Promise<T> | T,
  opts: RetryOptions,
): Promise<T> {
  const maxAttempts    = Math.max(1, opts.maxAttempts    ?? 3);
  const initialDelayMs = Math.max(0, opts.initialDelayMs ?? 200);
  const maxDelayMs     = Math.max(initialDelayMs, opts.maxDelayMs ?? 2000);
  const shouldRetry    = opts.shouldRetry ?? (() => true);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxAttempts;
      const retry  = !isLast && shouldRetry(err);

      opts.recoveryLog?.push({
        stage:    opts.stage,
        issue:    (err as any)?.message ?? "unknown error",
        action:   retry ? `Retrying (attempt ${attempt + 1}/${maxAttempts})` : "Giving up",
        severity: retry ? "warning" : "error",
        timestamp: Date.now(),
        attempt,
      });

      logger.warn(
        { stage: opts.stage, attempt, error: (err as any)?.message },
        `[self-healing] Stage "${opts.stage}" attempt ${attempt}/${maxAttempts} failed${retry ? " — retrying" : ""}`,
      );

      if (!retry) throw err;
      const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Resilient render loop (Step 32) ──────────────────────────────────────
// Wraps the render stage: attempts a render up to N times with a per-
// attempt variationIdx permutation. Keeps the best-scoring result across
// attempts. A thrown attempt is recorded but doesn't disqualify the
// entire render — if a later attempt succeeds, that becomes the result.
// If every attempt throws, the final error is rethrown so the top-level
// catastrophic catch in pipeline.ts can fall through to the degraded
// result path.

export interface ResilientRenderOptions<R> {
  stage:              string;                  // tag for logs
  maxAttempts?:       number;                  // default 2
  baseVariationIdx:   number;                  // seed; perturbed per attempt
  weakScoreThreshold?:number;                  // if score < threshold → try again
  // Per-attempt render. Returns a result + optional numeric score used to
  // pick the best across attempts. Score is optional; when absent we
  // assume the first successful attempt is good enough.
  render:             (variationIdx: number, attempt: number) => Promise<{
    result: R;
    score?: number;
  }>;
  recoveryLog?:       RecoveryAction[];
}

export async function runResilientRender<R>(
  opts: ResilientRenderOptions<R>,
): Promise<{ result: R; attempts: number; reason: "first_ok" | "best_of_n" }> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const threshold   = opts.weakScoreThreshold;
  let best: { result: R; score: number } | null = null;
  let lastErr: unknown = null;
  let attemptsRun = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsRun = attempt;
    // Per-attempt variationIdx perturbation — PRNG-friendly prime offset so
    // subsequent attempts sample a different composition / theme.
    const vIdx = opts.baseVariationIdx + (attempt - 1) * 13337;
    try {
      const { result, score } = await opts.render(vIdx, attempt);
      const s = typeof score === "number" ? score : Number.POSITIVE_INFINITY;

      if (!best || s > best.score) {
        best = { result, score: s };
      }

      // Strong enough — stop early to save work.
      if (threshold == null || s >= threshold || attempt === maxAttempts) {
        if (attempt > 1) {
          opts.recoveryLog?.push({
            stage:    opts.stage,
            issue:    threshold == null
              ? "previous attempt failed"
              : `previous attempt score below threshold ${threshold}`,
            action:   `Succeeded on attempt ${attempt}`,
            severity: "warning",
            timestamp: Date.now(),
            attempt,
          });
        }
        return {
          result:   best.result,
          attempts: attempt,
          reason:   attempt === 1 ? "first_ok" : "best_of_n",
        };
      }

      // Below threshold → try again.
      opts.recoveryLog?.push({
        stage:    opts.stage,
        issue:    `Attempt ${attempt} score ${s.toFixed(2)} below threshold ${threshold}`,
        action:   `Retrying with alternate variation (attempt ${attempt + 1}/${maxAttempts})`,
        severity: "warning",
        timestamp: Date.now(),
        attempt,
      });
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxAttempts;
      opts.recoveryLog?.push({
        stage:    opts.stage,
        issue:    (err as any)?.message ?? "unknown error",
        action:   isLast && !best
          ? "All attempts failed — propagating to catastrophic handler"
          : `Attempt ${attempt} failed — retrying (attempt ${attempt + 1}/${maxAttempts})`,
        severity: isLast && !best ? "critical" : "error",
        timestamp: Date.now(),
        attempt,
      });
      logger.warn(
        { stage: opts.stage, attempt, error: (err as any)?.message },
        `[self-healing] Resilient render attempt ${attempt}/${maxAttempts} failed`,
      );
    }
  }

  if (best) {
    return { result: best.result, attempts: attemptsRun, reason: "best_of_n" };
  }
  // Every attempt threw and no successful result was captured.
  throw lastErr ?? new Error(`[self-healing] ${opts.stage} exhausted all attempts`);
}

// ── Missing-asset recovery (Step 32) ─────────────────────────────────────
// After asset resolution, some placements may carry no URL and no useful
// prompt — e.g. an AI generation failed or an upstream library asset
// couldn't be materialized. Shipping such a placement produces a blank
// element. This helper drops those placements and reports each drop so
// the downstream renderer sees only renderable elements.

// Structural type the caller's element shape must satisfy. Callers pass
// their own richer types (e.g. ElementPlacement) and this function
// preserves the full type via the generic parameter.
export interface AssetCarrier {
  type:   string;
  zone:   string;
  url?:   string;
  prompt: string;
}

export function recoverMissingAssets<E extends AssetCarrier>(
  elements: E[],
  recoveryLog: RecoveryAction[],
  opts: { requireUrlForTypes?: string[] } = {},
): E[] {
  // Types that cannot render from a prompt alone (they need a resolved
  // bitmap URL). Everything else can fall back to the AI generation path
  // or SVG-composed content, so it's fine without a URL.
  const needsUrl = new Set(opts.requireUrlForTypes ?? ["human", "object", "photo"]);

  return elements.filter(el => {
    const hasUrl    = typeof el.url    === "string" && el.url.length    > 0;
    const hasPrompt = typeof el.prompt === "string" && el.prompt.trim().length > 0;

    // Completely empty — never renderable.
    if (!hasUrl && !hasPrompt) {
      recoveryLog.push({
        stage:    "asset_resolution",
        issue:    `Element type=${el.type} zone=${el.zone} has neither URL nor prompt`,
        action:   "Dropped empty placement",
        severity: "warning",
        timestamp: Date.now(),
      });
      return false;
    }

    // Needs-URL type without a URL — renderer can't substitute a prompt.
    if (needsUrl.has(el.type) && !hasUrl) {
      recoveryLog.push({
        stage:    "asset_resolution",
        issue:    `Element type=${el.type} zone=${el.zone} has no URL after resolution`,
        action:   `Dropped placement (type "${el.type}" requires a resolved URL)`,
        severity: "warning",
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  });
}

export function buildDegradedResult(
  input: PipelineInput,
  recoveryActions: RecoveryAction[],
): PipelineResult {
  const dims = FORMAT_DIMS[input.format] ?? { width: 1080, height: 1080 };
  const headline = input.brief.headline || "Design";
  const svgSource = buildSafetyNetSvg(dims.width, dims.height, headline);
  const buffer = Buffer.from(svgSource, "utf-8");
  const assetId = createHash("sha256")
    .update(`asset:${input.campaignId}:${input.format}:${input.variationIdx}:${input.outputFormat}`)
    .digest("hex")
    .slice(0, 24);

  return {
    buffer,
    mimeType: "image/svg+xml",
    svgSource,
    width: dims.width,
    height: dims.height,
    fileSize: buffer.length,
    assetId,
    brandScore: 0,
    hierarchyValid: false,
    layoutFamily: "fallback",
    layoutVariation: "safety_net",
    violations: [
      "self_healing:critical: pipeline failed catastrophically — returning safety-net SVG",
      ...recoveryActions.map(a => `self_healing:${a.severity}:${a.stage}: ${a.issue} → ${a.action}`),
    ],
    durationMs: 0,
  };
}
