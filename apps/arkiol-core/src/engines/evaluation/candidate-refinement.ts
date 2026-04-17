// src/engines/evaluation/candidate-refinement.ts
//
// Post-build design quality assessment and automatic refinement.
// Evaluates completed designs for contrast compliance, overflow risk,
// spacing quality, visual balance, hierarchy clarity, and color harmony.
// Auto-fixes detectable issues (contrast, overflow, hierarchy) without
// requiring additional AI calls.

import type { Zone, ZoneId } from "../layout/families";
import type { SvgContent } from "../render/svg-builder-ultimate";
import { FORMAT_DIMS } from "../../lib/types";

// ── Quality report ───────────────────────────────────────────────────────────

export interface DesignQualityReport {
  contrastCompliance: number;
  overflowRisk: number;
  spacingQuality: number;
  visualBalance: number;
  hierarchyClarity: number;
  colorHarmony: number;
  overall: number;
  issues: QualityIssue[];
}

export interface QualityIssue {
  type: "contrast" | "overflow" | "spacing" | "balance" | "hierarchy";
  severity: "warning" | "error";
  zoneId?: string;
  message: string;
  autoFixable: boolean;
}

export interface RefinementResult {
  content: SvgContent;
  actions: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3.0;
const LARGE_TEXT_PX = 18;
const LARGE_BOLD_TEXT_PX = 14;

const OVERFLOW_WARNING = 1.1;
const OVERFLOW_ERROR = 1.4;

const QUALITY_WEIGHTS = {
  contrastCompliance: 0.22,
  overflowRisk:       0.18,
  spacingQuality:     0.12,
  visualBalance:      0.12,
  hierarchyClarity:   0.18,
  colorHarmony:       0.18,
};

// ── Assessment ───────────────────────────────────────────────────────────────

export function assessDesignQuality(
  content: SvgContent,
  zones: Zone[],
  format?: string,
): DesignQualityReport {
  const dims = format
    ? (FORMAT_DIMS[format] ?? { width: 1080, height: 1080 })
    : { width: 1080, height: 1080 };
  const zoneMap = new Map(zones.map(z => [z.id, z]));
  const issues: QualityIssue[] = [];
  const bgColor = content.backgroundColor ?? "#ffffff";
  const bgLum = relativeLuminance(bgColor);

  // ── Contrast compliance ────────────────────────────────────────────────
  let contrastPassing = 0;
  let contrastTotal = 0;

  for (const tc of content.textContents) {
    if (!tc.text?.trim()) continue;
    contrastTotal++;
    const textLum = relativeLuminance(tc.color);
    const ratio = contrastRatio(textLum, bgLum);
    const isLarge = tc.fontSize >= LARGE_TEXT_PX ||
      (tc.fontSize >= LARGE_BOLD_TEXT_PX && tc.weight >= 700);
    const target = isLarge ? WCAG_AA_LARGE : WCAG_AA_NORMAL;

    if (ratio >= target) {
      contrastPassing++;
    } else {
      issues.push({
        type: "contrast",
        severity: ratio < 2.5 ? "error" : "warning",
        zoneId: tc.zoneId,
        message: `contrast ${ratio.toFixed(1)}:1 below ${target}:1`,
        autoFixable: true,
      });
    }
  }

  if (content.ctaStyle) {
    contrastTotal++;
    const ctaRatio = contrastRatio(
      relativeLuminance(content.ctaStyle.textColor),
      relativeLuminance(content.ctaStyle.backgroundColor),
    );
    if (ctaRatio >= WCAG_AA_LARGE) {
      contrastPassing++;
    } else {
      issues.push({
        type: "contrast",
        severity: "error",
        zoneId: "cta",
        message: `CTA button contrast ${ctaRatio.toFixed(1)}:1 below ${WCAG_AA_LARGE}:1`,
        autoFixable: true,
      });
    }
  }

  const contrastCompliance = contrastTotal > 0 ? contrastPassing / contrastTotal : 1;

  // ── Overflow risk ──────────────────────────────────────────────────────
  let overflowScore = 1;
  for (const tc of content.textContents) {
    const zone = zoneMap.get(tc.zoneId as ZoneId);
    if (!zone || !tc.text?.trim()) continue;

    const zW = (zone.width / 100) * dims.width;
    const zH = (zone.height / 100) * dims.height;
    const risk = estimateOverflowRisk(tc.text, tc.fontSize, zW, zH);

    if (risk > OVERFLOW_ERROR) {
      issues.push({
        type: "overflow", severity: "error", zoneId: tc.zoneId,
        message: `text likely overflows (risk ${risk.toFixed(2)})`,
        autoFixable: true,
      });
      overflowScore = Math.min(overflowScore, 0.3);
    } else if (risk > OVERFLOW_WARNING) {
      issues.push({
        type: "overflow", severity: "warning", zoneId: tc.zoneId,
        message: `text may overflow (risk ${risk.toFixed(2)})`,
        autoFixable: true,
      });
      overflowScore = Math.min(overflowScore, 0.6);
    }
  }

  // ── Spacing quality ────────────────────────────────────────────────────
  const populatedZones = zones
    .filter(z => content.textContents.some(tc => tc.zoneId === z.id && tc.text?.trim()))
    .sort((a, b) => a.y - b.y);

  let spacingScore = 1;
  const gaps: number[] = [];
  for (let i = 1; i < populatedZones.length; i++) {
    const prevBottom = populatedZones[i - 1].y + populatedZones[i - 1].height;
    const gap = populatedZones[i].y - prevBottom;
    gaps.push(gap);
    if (gap < 1) {
      issues.push({
        type: "spacing", severity: "error", zoneId: populatedZones[i].id,
        message: `overlaps previous zone (gap ${gap.toFixed(1)}%)`,
        autoFixable: false,
      });
      spacingScore = Math.min(spacingScore, 0.3);
    } else if (gap < 2) {
      spacingScore = Math.min(spacingScore, 0.7);
    }
  }
  if (gaps.length >= 2) {
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance = gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length;
    if (variance > 40) spacingScore = Math.min(spacingScore, 0.6);
  }

  // ── Visual balance ─────────────────────────────────────────────────────
  let wX = 0, wY = 0, totalW = 0;
  for (const tc of content.textContents) {
    const zone = zoneMap.get(tc.zoneId as ZoneId);
    if (!zone || !tc.text?.trim()) continue;
    const w = tc.fontSize * tc.text.length;
    wX += (zone.x + zone.width / 2) * w;
    wY += (zone.y + zone.height / 2) * w;
    totalW += w;
  }
  let visualBalance = 0.8;
  if (totalW > 0) {
    const comX = wX / totalW;
    const comY = wY / totalW;
    const devX = Math.abs(comX - 50) / 50;
    const devY = Math.abs(comY - 50) / 50;
    visualBalance = clamp(1 - (devX * 0.6 + devY * 0.4), 0.2, 1);
    if (visualBalance < 0.4) {
      issues.push({
        type: "balance", severity: "warning",
        message: `center of mass at (${comX.toFixed(0)}%, ${comY.toFixed(0)}%)`,
        autoFixable: false,
      });
    }
  }

  // ── Hierarchy clarity ──────────────────────────────────────────────────
  const headlineTC = content.textContents.find(
    tc => (tc.zoneId === "headline" || tc.zoneId === "name") && tc.text?.trim(),
  );
  const otherTC = content.textContents.filter(
    tc => tc.zoneId !== "headline" && tc.zoneId !== "name" && tc.text?.trim(),
  );
  let hierarchyClarity = 0.8;
  if (headlineTC && otherTC.length > 0) {
    const maxOther = Math.max(...otherTC.map(tc => tc.fontSize));
    const ratio = headlineTC.fontSize / maxOther;
    if (ratio < 1.0) {
      issues.push({
        type: "hierarchy", severity: "error", zoneId: "headline",
        message: `headline (${headlineTC.fontSize}px) smaller than other text (${maxOther}px)`,
        autoFixable: true,
      });
      hierarchyClarity = 0.3;
    } else if (ratio < 1.3) {
      hierarchyClarity = 0.6;
    } else if (ratio >= 1.5) {
      hierarchyClarity = 1.0;
    }
  }

  // ── Color harmony ─────────────────────────────────────────────────────
  const hues = content.textContents
    .filter(tc => tc.text?.trim())
    .map(tc => hexToHue(tc.color))
    .filter(h => h >= 0);

  let colorHarmony = 0.8;
  if (hues.length >= 2) {
    const hueRange = Math.max(...hues) - Math.min(...hues);
    if (hueRange > 300)      colorHarmony = 0.5;
    else if (hueRange > 180) colorHarmony = 0.7;
    else if (hueRange < 60)  colorHarmony = 1.0;
  }

  const overall =
    contrastCompliance * QUALITY_WEIGHTS.contrastCompliance +
    overflowScore      * QUALITY_WEIGHTS.overflowRisk +
    spacingScore       * QUALITY_WEIGHTS.spacingQuality +
    visualBalance      * QUALITY_WEIGHTS.visualBalance +
    hierarchyClarity   * QUALITY_WEIGHTS.hierarchyClarity +
    colorHarmony       * QUALITY_WEIGHTS.colorHarmony;

  return {
    contrastCompliance,
    overflowRisk: overflowScore,
    spacingQuality: spacingScore,
    visualBalance,
    hierarchyClarity,
    colorHarmony,
    overall,
    issues,
  };
}

// ── Refinement ───────────────────────────────────────────────────────────────

export function refineDesign(
  content: SvgContent,
  report: DesignQualityReport,
  zones: Zone[],
  format?: string,
): RefinementResult {
  const dims = format
    ? (FORMAT_DIMS[format] ?? { width: 1080, height: 1080 })
    : { width: 1080, height: 1080 };
  const fixable = report.issues.filter(i => i.autoFixable);
  if (fixable.length === 0) return { content, actions: [] };

  const zoneMap = new Map(zones.map(z => [z.id, z]));
  const textContents = content.textContents.map(tc => ({ ...tc }));
  let ctaStyle = content.ctaStyle ? { ...content.ctaStyle } : content.ctaStyle;
  const bgColor = content.backgroundColor ?? "#ffffff";
  const actions: string[] = [];

  for (const issue of fixable) {
    switch (issue.type) {
      case "contrast": {
        if (issue.zoneId === "cta" && ctaStyle) {
          const fixed = fixContrast(ctaStyle.textColor, ctaStyle.backgroundColor, WCAG_AA_LARGE);
          if (fixed !== ctaStyle.textColor) {
            actions.push(`fix_contrast:cta ${ctaStyle.textColor}→${fixed}`);
            ctaStyle = { ...ctaStyle, textColor: fixed };
          }
        } else if (issue.zoneId) {
          const tc = textContents.find(t => t.zoneId === issue.zoneId);
          if (tc) {
            const isLarge = tc.fontSize >= LARGE_TEXT_PX ||
              (tc.fontSize >= LARGE_BOLD_TEXT_PX && tc.weight >= 700);
            const target = isLarge ? WCAG_AA_LARGE : WCAG_AA_NORMAL;
            const fixed = fixContrast(tc.color, bgColor, target);
            if (fixed !== tc.color) {
              actions.push(`fix_contrast:${tc.zoneId} ${tc.color}→${fixed}`);
              tc.color = fixed;
            }
          }
        }
        break;
      }

      case "overflow": {
        if (!issue.zoneId) break;
        const tc = textContents.find(t => t.zoneId === issue.zoneId);
        const zone = zoneMap.get(issue.zoneId as ZoneId);
        if (tc && zone) {
          const zW = (zone.width / 100) * dims.width;
          const zH = (zone.height / 100) * dims.height;
          const risk = estimateOverflowRisk(tc.text, tc.fontSize, zW, zH);
          if (risk > OVERFLOW_WARNING) {
            const reduction = Math.min(0.85, 1 / risk);
            const newSize = Math.max(10, Math.round(tc.fontSize * reduction));
            if (newSize < tc.fontSize) {
              actions.push(`fix_overflow:${tc.zoneId} ${tc.fontSize}→${newSize}px`);
              tc.fontSize = newSize;
            }
          }
        }
        break;
      }

      case "hierarchy": {
        const headline = textContents.find(
          tc => (tc.zoneId === "headline" || tc.zoneId === "name") && tc.text?.trim(),
        );
        const others = textContents.filter(
          tc => tc.zoneId !== "headline" && tc.zoneId !== "name" && tc.text?.trim(),
        );
        if (headline && others.length > 0) {
          const maxOther = Math.max(...others.map(tc => tc.fontSize));
          if (headline.fontSize <= maxOther) {
            const newSize = Math.round(maxOther * 1.4);
            actions.push(`fix_hierarchy:headline ${headline.fontSize}→${newSize}px`);
            headline.fontSize = newSize;
          }
        }
        break;
      }
    }
  }

  return {
    content: { ...content, textContents, ctaStyle },
    actions,
  };
}

// ── Color helpers ────────────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b]
    .map(c => clamp(c, 0, 255).toString(16).padStart(2, "0"))
    .join("");
}

function relativeLuminance(hex: string): number {
  if (!hex.startsWith("#")) return 0.5;
  const [r, g, b] = hexToRGB(hex);
  const [rL, gL, bL] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function fixContrast(textHex: string, bgHex: string, targetRatio: number): string {
  const bgLum = relativeLuminance(bgHex);
  if (contrastRatio(relativeLuminance(textHex), bgLum) >= targetRatio) return textHex;

  const [or, og, ob] = hexToRGB(textHex);
  const target = bgLum < 0.4 ? [255, 255, 255] : [0, 0, 0];

  for (let t = 0.1; t <= 1.0; t += 0.1) {
    const r = Math.round(or + (target[0] - or) * t);
    const g = Math.round(og + (target[1] - og) * t);
    const b = Math.round(ob + (target[2] - ob) * t);
    const hex = rgbToHex(r, g, b);
    if (contrastRatio(relativeLuminance(hex), bgLum) >= targetRatio) return hex;
  }
  return bgLum < 0.4 ? "#ffffff" : "#000000";
}

function estimateOverflowRisk(
  text: string, fontSize: number, zoneWPx: number, zoneHPx: number,
): number {
  if (zoneWPx <= 0 || zoneHPx <= 0) return 2;
  const avgCharW = fontSize * 0.55;
  const lineH = fontSize * 1.25;
  const charsPerLine = Math.max(1, Math.floor(zoneWPx / avgCharW));
  const linesNeeded = Math.ceil(text.length / charsPerLine);
  return (linesNeeded * lineH) / zoneHPx;
}

function hexToHue(hex: string): number {
  if (!hex.startsWith("#")) return -1;
  const [r, g, b] = hexToRGB(hex).map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
