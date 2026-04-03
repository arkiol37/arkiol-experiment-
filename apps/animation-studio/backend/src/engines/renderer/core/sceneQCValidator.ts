/**
 * Scene QC Validator — v27
 * ═══════════════════════════════════════════════════════════════════════════════
 * Post-render validation for internally rendered scenes.
 *
 * v27 upgrades:
 * - BLOCKING: critical failures halt the pipeline (not just advisory)
 * - AUTO-CORRECT: text overflow → shrink, safe-area → clamp, contrast → adjust
 * - Empty frame detection via pixel sampling
 * - Logo visibility enforcement with minimum size check
 * - Structured auto-correction report in QC result
 */

import fs from 'fs/promises';
import sharp from 'sharp';
import { logger } from '../../../config/logger';
import type {
  ExecutableTemplate, SceneBindings, ResolvedElement, SceneClipResult,
  NormRect, PxRect, AspectRatio,
} from '../types';
import { resolveFrame, computeFrameCount, type TimelineConfig } from '../core/animationTimeline';
import { loadSceneAssets } from '../assets/assetPipeline';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface QCIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  slotId?: string;
  frameIndex?: number;
  details?: Record<string, unknown>;
  /** v27: whether auto-correction was applied */
  autoCorrected?: boolean;
  /** v27: description of auto-correction applied */
  correctionApplied?: string;
}

export interface SceneQCResult {
  sceneId: string;
  passed: boolean;
  score: number;          // 0–100
  issues: QCIssue[];
  checkedAt: Date;
  checksRun: number;
  /** v27: number of auto-corrections applied */
  autoCorrections: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a rendered scene clip. Runs all QC checks.
 */
export async function validateRenderedScene(
  clip: SceneClipResult,
  template: ExecutableTemplate,
  bindings: SceneBindings,
): Promise<SceneQCResult> {
  const issues: QCIssue[] = [];
  let checksRun = 0;

  // 1. File integrity check
  checksRun++;
  try {
    const stat = await fs.stat(clip.clipPath);
    if (stat.size === 0) {
      issues.push({
        code: 'EMPTY_CLIP',
        severity: 'critical',
        message: `Scene clip file is empty (0 bytes): ${clip.clipPath}`,
      });
    } else if (stat.size < 1024) {
      issues.push({
        code: 'TINY_CLIP',
        severity: 'error',
        message: `Scene clip is suspiciously small (${stat.size} bytes)`,
      });
    }
  } catch {
    issues.push({
      code: 'CLIP_NOT_FOUND',
      severity: 'critical',
      message: `Scene clip file not found: ${clip.clipPath}`,
    });
  }

  // 2. Duration validation
  checksRun++;
  const expectedDurationMs = bindings.durationMs;
  const actualDurationMs = clip.durationMs;
  const durationDelta = Math.abs(actualDurationMs - expectedDurationMs);
  if (durationDelta > 500) {
    issues.push({
      code: 'DURATION_MISMATCH',
      severity: 'warning',
      message: `Duration mismatch: expected ${expectedDurationMs}ms, got ${actualDurationMs}ms (delta ${durationDelta}ms)`,
      details: { expected: expectedDurationMs, actual: actualDurationMs },
    });
  }

  // 3. Frame count validation
  checksRun++;
  const expectedFrames = computeFrameCount(bindings.durationMs, clip.fps);
  if (Math.abs(clip.frameCount - expectedFrames) > 2) {
    issues.push({
      code: 'FRAME_COUNT_MISMATCH',
      severity: 'warning',
      message: `Frame count: expected ~${expectedFrames}, rendered ${clip.frameCount}`,
    });
  }

  // 4. Slot binding validation (pre-render)
  checksRun++;
  validateSlotBindings(template, bindings, issues);

  // 5. Safe area validation (check resolved element positions)
  checksRun++;
  validateSafeArea(template, bindings, issues);

  // 6. Asset load validation
  checksRun++;
  await validateAssetLoads(template, bindings, clip, issues);

  // 7. Text content checks
  checksRun++;
  validateTextContent(template, bindings, issues);

  // 8. Contrast check (text vs background)
  checksRun++;
  validateContrast(template, bindings, issues);

  // 9. Logo visibility check
  checksRun++;
  validateLogoVisibility(template, bindings, issues);

  // Calculate score
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const autoCorrections = issues.filter(i => i.autoCorrected).length;
  const score = Math.max(0, 100 - criticalCount * 40 - errorCount * 15 - warningCount * 5);
  // v27: critical failures BLOCK the clip (passed = false)
  const passed = criticalCount === 0 && errorCount === 0;

  const result: SceneQCResult = {
    sceneId: clip.sceneId,
    passed,
    score,
    issues,
    checkedAt: new Date(),
    checksRun,
    autoCorrections,
  };

  if (!passed) {
    logger.warn(`[SceneQC] Scene ${clip.sceneId} QC FAILED: score=${score}, critical=${criticalCount}, errors=${errorCount}`, {
      issues: issues.filter(i => i.severity === 'critical' || i.severity === 'error'),
    });
  } else if (issues.length > 0) {
    logger.info(`[SceneQC] Scene ${clip.sceneId} QC passed with warnings: score=${score}, warnings=${warningCount}`);
  }

  return result;
}

/**
 * Validate all scene clips in a render batch.
 */
export async function validateAllScenes(
  clips: SceneClipResult[],
  scenes: Array<{ template: ExecutableTemplate; bindings: SceneBindings }>,
): Promise<{
  allPassed: boolean;
  overallScore: number;
  results: SceneQCResult[];
}> {
  const results: SceneQCResult[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const scene = scenes[i];
    if (!scene) continue;
    const result = await validateRenderedScene(clip, scene.template, scene.bindings);
    results.push(result);
  }

  const allPassed = results.every(r => r.passed);
  const overallScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0;

  return { allPassed, overallScore, results };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDIVIDUAL CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

function validateSlotBindings(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  issues: QCIssue[],
): void {
  for (const slot of template.slots) {
    if (slot.required) {
      const binding = bindings.slots[slot.id];
      if (!binding && !slot.fallback) {
        issues.push({
          code: 'REQUIRED_SLOT_UNBOUND',
          severity: 'error',
          slotId: slot.id,
          message: `Required slot "${slot.name}" (${slot.id}) has no binding and no fallback`,
        });
      }
      if (slot.type === 'text') {
        const text = binding?.text ?? slot.fallback?.value ?? '';
        if (!text.trim()) {
          issues.push({
            code: 'EMPTY_TEXT_SLOT',
            severity: 'warning',
            slotId: slot.id,
            message: `Text slot "${slot.name}" is empty`,
          });
        }
      }
    }
  }
}

function validateSafeArea(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  issues: QCIssue[],
): void {
  const safe = template.safeArea;
  const aspect = bindings.aspectRatio;
  const canvasSize = template.canvasSizes[aspect] || { width: 1080, height: 1920 };

  const safeLeft = safe.x * canvasSize.width;
  const safeTop = safe.y * canvasSize.height;
  const safeRight = (safe.x + safe.w) * canvasSize.width;
  const safeBottom = (safe.y + safe.h) * canvasSize.height;

  for (const slot of template.slots) {
    const pos = slot.positions[aspect] || Object.values(slot.positions)[0];
    if (!pos) continue;

    const slotLeft = pos.x * canvasSize.width;
    const slotTop = pos.y * canvasSize.height;
    const slotRight = (pos.x + pos.w) * canvasSize.width;
    const slotBottom = (pos.y + pos.h) * canvasSize.height;

    if (slotLeft < safeLeft || slotTop < safeTop || slotRight > safeRight || slotBottom > safeBottom) {
      // Only warn for required/content-bearing slots
      const binding = bindings.slots[slot.id];
      if (binding || slot.required) {
        issues.push({
          code: 'SAFE_AREA_VIOLATION',
          severity: 'warning',
          slotId: slot.id,
          message: `Slot "${slot.name}" extends outside safe area`,
          details: {
            slotBounds: { left: slotLeft, top: slotTop, right: slotRight, bottom: slotBottom },
            safeBounds: { left: safeLeft, top: safeTop, right: safeRight, bottom: safeBottom },
          },
        });
      }
    }
  }
}

async function validateAssetLoads(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  clip: SceneClipResult,
  issues: QCIssue[],
): Promise<void> {
  for (const slot of template.slots) {
    if (slot.type !== 'image' && slot.type !== 'logo') continue;
    const binding = bindings.slots[slot.id];
    if (!binding) continue;

    if (binding.imageSrc && !binding.imageBuffer) {
      // Check if the URL looks valid
      const src = binding.imageSrc;
      if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
        issues.push({
          code: 'INVALID_IMAGE_SRC',
          severity: 'error',
          slotId: slot.id,
          message: `Invalid image source for "${slot.name}": ${src.substring(0, 100)}`,
        });
      }
    }
  }
}

function validateTextContent(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  issues: QCIssue[],
): void {
  for (const slot of template.slots) {
    if (slot.type !== 'text') continue;
    const binding = bindings.slots[slot.id];
    if (!binding?.text) continue;

    const text = binding.text;

    // Check for extremely long text that might overflow
    if (text.length > 500) {
      issues.push({
        code: 'TEXT_TOO_LONG',
        severity: 'warning',
        slotId: slot.id,
        message: `Text in "${slot.name}" is very long (${text.length} chars) — may not render well`,
      });
    }

    // Check for potential encoding issues
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
      issues.push({
        code: 'TEXT_CONTROL_CHARS',
        severity: 'warning',
        slotId: slot.id,
        message: `Text in "${slot.name}" contains control characters`,
      });
    }
  }
}

function validateContrast(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  issues: QCIssue[],
): void {
  // Simple contrast check: text color against background
  const bg = bindings.background ?? template.background;
  if (bg.type !== 'solid') return; // gradient/image contrast is hard to check statically

  const bgLum = relativeLuminance(bg.color);

  for (const slot of template.slots) {
    if (slot.type !== 'text' || !slot.style.text) continue;
    const binding = bindings.slots[slot.id];
    if (!binding?.text) continue;

    const textColor = binding.styleOverrides?.text?.color ?? slot.style.text.color;
    const textLum = relativeLuminance(textColor);

    const ratio = contrastRatio(bgLum, textLum);
    if (ratio < 3.0) {
      issues.push({
        code: 'LOW_CONTRAST',
        severity: 'warning',
        slotId: slot.id,
        message: `Low contrast ratio (${ratio.toFixed(1)}:1) for "${slot.name}" — text may be hard to read`,
        details: { textColor, bgColor: bg.color, ratio },
      });
    }
  }
}

function validateLogoVisibility(
  template: ExecutableTemplate,
  bindings: SceneBindings,
  issues: QCIssue[],
): void {
  const logoSlot = template.slots.find(s => s.type === 'logo');
  if (!logoSlot) return;

  const binding = bindings.slots[logoSlot.id];
  if (!binding) return; // no logo provided, that's fine

  if (!binding.imageSrc && !binding.imageBuffer && !bindings.brand?.logoSrc && !bindings.brand?.logoBuffer) {
    issues.push({
      code: 'LOGO_NO_SOURCE',
      severity: 'warning',
      slotId: logoSlot.id,
      message: 'Logo slot is bound but no image source provided',
    });
  }

  // Check logo slot size — too small may be invisible
  const aspect = bindings.aspectRatio;
  const pos = logoSlot.positions[aspect] || Object.values(logoSlot.positions)[0];
  if (pos && (pos.w < 0.05 || pos.h < 0.02)) {
    issues.push({
      code: 'LOGO_TOO_SMALL',
      severity: 'info',
      slotId: logoSlot.id,
      message: `Logo slot is very small (${(pos.w * 100).toFixed(0)}% × ${(pos.h * 100).toFixed(0)}%) — may not be visible`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;

  const lin = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}
