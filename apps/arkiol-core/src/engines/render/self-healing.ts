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
