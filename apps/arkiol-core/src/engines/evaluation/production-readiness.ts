// src/engines/evaluation/production-readiness.ts
//
// Production readiness scoring — a single "is this ready to ship?" assessment
// that combines all quality signals into one score with engagement estimation.
//
// Used by the pipeline to:
//   1. Decide if a generated design meets the production bar
//   2. Bias multi-candidate selection toward stronger outputs
//   3. Surface a clear readiness verdict (ready / needs_review / reject)
//
// All scoring is deterministic — no GPT calls.

import type { SvgContent } from "../render/svg-builder-ultimate";
import type { Zone } from "../layout/families";
import type { CandidateQualityScore } from "./candidate-quality";
import type { DesignQualityReport } from "./candidate-refinement";

// ── Readiness verdict ───────────────────────────────────────────────────────

export type ReadinessVerdict = "ready" | "needs_review" | "reject";

export interface ProductionReadinessReport {
  verdict: ReadinessVerdict;
  overallScore: number;

  // Dimension scores (0–1)
  readabilityScore: number;
  clarityScore: number;
  hierarchyScore: number;
  engagementScore: number;
  polishScore: number;

  // Issues that prevent production readiness
  blockers: string[];
  warnings: string[];
}

// ── Thresholds ──────────────────────────────────────────────────────────────

const READY_THRESHOLD = 0.62;
const REJECT_THRESHOLD = 0.35;

// ── Main scorer ─────────────────────────────────────────────────────────────

export function assessProductionReadiness(
  content: SvgContent,
  zones: Zone[],
  format: string,
  themeScore?: CandidateQualityScore,
  designReport?: DesignQualityReport,
): ProductionReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const readabilityScore = scoreReadability(content, zones, blockers, warnings);
  const clarityScore = scoreClarity(content, blockers, warnings);
  const hierarchyScore = scoreHierarchy(content, blockers, warnings);
  const engagementScore = scoreEngagement(content, format, themeScore);
  const polishScore = scorePolish(content, designReport, warnings);

  // Weighted combination
  const overallScore =
    readabilityScore * 0.25 +
    clarityScore * 0.20 +
    hierarchyScore * 0.20 +
    engagementScore * 0.15 +
    polishScore * 0.20;

  let verdict: ReadinessVerdict = "ready";
  if (overallScore < REJECT_THRESHOLD || blockers.length > 0) verdict = "reject";
  else if (overallScore < READY_THRESHOLD || warnings.length > 3) verdict = "needs_review";

  return {
    verdict,
    overallScore,
    readabilityScore,
    clarityScore,
    hierarchyScore,
    engagementScore,
    polishScore,
    blockers,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § READABILITY — can users actually read the text?
// ═══════════════════════════════════════════════════════════════════════════════

function scoreReadability(
  content: SvgContent,
  zones: Zone[],
  blockers: string[],
  warnings: string[],
): number {
  if (content.textContents.length === 0) return 0.5;

  let totalScore = 0;
  let count = 0;

  for (const tc of content.textContents) {
    const zone = zones.find(z => z.id === tc.zoneId);
    if (!zone) continue;
    count++;

    let zoneScore = 1.0;

    // Font size check — too small to read
    if (tc.fontSize < 12) {
      blockers.push(`Zone "${tc.zoneId}" font size ${tc.fontSize}px is below readable minimum`);
      zoneScore = 0.2;
    } else if (tc.fontSize < 14) {
      warnings.push(`Zone "${tc.zoneId}" font size ${tc.fontSize}px is small`);
      zoneScore = 0.6;
    }

    // Contrast — check text against background
    const ratio = contrastRatio(tc.color, content.backgroundColor);
    if (ratio < 2.0) {
      blockers.push(`Zone "${tc.zoneId}" contrast ratio ${ratio.toFixed(1)} is unreadable`);
      zoneScore *= 0.2;
    } else if (ratio < 3.0) {
      warnings.push(`Zone "${tc.zoneId}" contrast ratio ${ratio.toFixed(1)} is low`);
      zoneScore *= 0.6;
    } else if (ratio < 4.5) {
      zoneScore *= 0.85;
    }

    // Text length vs font size — big text shouldn't be too long
    if (tc.fontSize >= 36 && tc.text.length > 60) {
      warnings.push(`Zone "${tc.zoneId}" has large text (${tc.fontSize}px) with ${tc.text.length} chars`);
      zoneScore *= 0.8;
    }

    totalScore += zoneScore;
  }

  return count > 0 ? totalScore / count : 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § CLARITY — is the message clear and well-structured?
// ═══════════════════════════════════════════════════════════════════════════════

function scoreClarity(
  content: SvgContent,
  blockers: string[],
  warnings: string[],
): number {
  let score = 0.7;

  // Must have a headline
  const headline = content.textContents.find(
    tc => tc.zoneId === "headline" || tc.zoneId === "name"
  );
  if (!headline || !headline.text.trim()) {
    blockers.push("No headline text — design lacks primary message");
    return 0.1;
  }

  // Headline quality
  if (headline.text.length < 3) {
    warnings.push("Headline is too short to be meaningful");
    score -= 0.2;
  } else if (headline.text.length > 60) {
    warnings.push("Headline exceeds 60 chars — may be hard to scan");
    score -= 0.1;
  } else {
    score += 0.15;
  }

  // CTA presence (for formats that typically need one)
  const hasCta = content.textContents.some(tc => tc.zoneId === "cta" && tc.text.trim());
  if (hasCta) score += 0.1;

  // Subhead complements headline
  const hasSubhead = content.textContents.some(
    tc => (tc.zoneId === "subhead" || tc.zoneId === "tagline") && tc.text.trim()
  );
  if (hasSubhead) score += 0.05;

  return clamp(score, 0, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § HIERARCHY — is there clear visual ordering?
// ═══════════════════════════════════════════════════════════════════════════════

function scoreHierarchy(
  content: SvgContent,
  blockers: string[],
  warnings: string[],
): number {
  const zones = content.textContents.filter(tc => tc.text.trim());
  if (zones.length < 2) return 0.7;

  const headline = zones.find(tc => tc.zoneId === "headline" || tc.zoneId === "name");
  if (!headline) return 0.5;

  const others = zones.filter(tc => tc !== headline);
  const maxOtherSize = Math.max(...others.map(tc => tc.fontSize));

  if (maxOtherSize === 0) return 0.8;

  const ratio = headline.fontSize / maxOtherSize;

  if (ratio < 1.0) {
    blockers.push(`Headline (${headline.fontSize}px) is smaller than other text (${maxOtherSize}px)`);
    return 0.15;
  }
  if (ratio < 1.2) {
    warnings.push(`Headline is barely larger than body text (ratio ${ratio.toFixed(2)})`);
    return 0.45;
  }
  if (ratio < 1.5) return 0.7;
  if (ratio < 2.0) return 0.85;
  return 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § ENGAGEMENT — how likely is this design to capture attention?
// ═══════════════════════════════════════════════════════════════════════════════

function scoreEngagement(
  content: SvgContent,
  format: string,
  themeScore?: CandidateQualityScore,
): number {
  let score = 0.5;

  // Visual richness from theme score
  if (themeScore) {
    score = 0.3 + themeScore.total * 0.5;
  }

  // Background complexity boosts engagement
  if (content.backgroundGradient?.type === "linear" || content.backgroundGradient?.type === "radial") {
    score += 0.05;
  }

  // Accent shape adds visual interest
  if (content.accentShape && content.accentShape.type !== "none") {
    score += 0.05;
  }

  // CTA with shadow suggests depth
  if (content.ctaStyle?.shadow) {
    score += 0.03;
  }

  // Overlay creates depth on image-led formats
  if (content.overlayOpacity && content.overlayOpacity > 0.1) {
    score += 0.04;
  }

  // Format-specific engagement signals
  if (format.includes("story") || format.includes("reel")) {
    // Stories need high visual impact
    const headline = content.textContents.find(tc => tc.zoneId === "headline");
    if (headline && headline.fontSize >= 48) score += 0.05;
    if (headline && headline.weight >= 700) score += 0.03;
  }

  if (format.includes("thumbnail")) {
    // Thumbnails need bold, scannable design
    const headline = content.textContents.find(tc => tc.zoneId === "headline");
    if (headline && headline.weight >= 800) score += 0.05;
  }

  return clamp(score, 0, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § POLISH — is the design clean and well-finished?
// ═══════════════════════════════════════════════════════════════════════════════

function scorePolish(
  content: SvgContent,
  designReport: DesignQualityReport | undefined,
  warnings: string[],
): number {
  let score = 0.7;

  // Pull from existing design quality report if available
  if (designReport) {
    score = designReport.overall * 0.6 + 0.3;

    if (designReport.contrastCompliance < 0.8) {
      warnings.push("Some text zones have low contrast");
      score -= 0.1;
    }
    if (designReport.overflowRisk > 0.3) {
      warnings.push("Text overflow risk detected in some zones");
      score -= 0.1;
    }
  }

  // Font weight consistency check — same-role zones should share weights
  const bodyZones = content.textContents.filter(tc =>
    tc.zoneId === "body" || tc.zoneId === "body_text" || tc.zoneId === "subhead"
  );
  if (bodyZones.length >= 2) {
    const weights = new Set(bodyZones.map(tc => tc.weight));
    if (weights.size > 2) {
      warnings.push("Inconsistent font weights across body text zones");
      score -= 0.05;
    }
  }

  // Font family consistency — all text should use at most 2 font families
  const families = new Set(content.textContents.map(tc => tc.fontFamily));
  if (families.size > 3) {
    warnings.push(`${families.size} different font families — too many`);
    score -= 0.1;
  }

  // CTA quality checks
  if (content.ctaStyle) {
    const ctaText = content.textContents.find(tc => tc.zoneId === "cta");
    if (ctaText && ctaText.text.length > 25) {
      warnings.push("CTA text is longer than 25 chars — may reduce click-through");
      score -= 0.05;
    }
  }

  // Background color validation
  if (!content.backgroundColor || content.backgroundColor === "#000000") {
    if (!content._selectedTheme?.palette?.background) {
      warnings.push("Background color may be missing or defaulting to black");
      score -= 0.05;
    }
  }

  return clamp(score, 0, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § SELECTION BIAS — score comparison for multi-candidate selection
// ═══════════════════════════════════════════════════════════════════════════════

export interface CandidateComparison {
  selectedIndex: number;
  scores: number[];
  margin: number;
}

export function selectStrongestCandidate(
  reports: ProductionReadinessReport[],
): CandidateComparison {
  if (reports.length === 0) return { selectedIndex: 0, scores: [], margin: 0 };
  if (reports.length === 1) return { selectedIndex: 0, scores: [reports[0].overallScore], margin: 0 };

  const scores = reports.map(r => r.overallScore);

  // Bias: penalize candidates with blockers
  const adjustedScores = reports.map((r, i) => {
    let adjusted = scores[i];
    if (r.blockers.length > 0) adjusted *= 0.5;
    if (r.verdict === "reject") adjusted *= 0.3;
    return adjusted;
  });

  let bestIdx = 0;
  for (let i = 1; i < adjustedScores.length; i++) {
    if (adjustedScores[i] > adjustedScores[bestIdx]) bestIdx = i;
  }

  const sortedScores = [...adjustedScores].sort((a, b) => b - a);
  const margin = sortedScores.length >= 2 ? sortedScores[0] - sortedScores[1] : 0;

  return { selectedIndex: bestIdx, scores: adjustedScores, margin };
}

// ── Contrast ratio (WCAG) ───────────────────────────────────────────────────

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return 0;
  const r = sRGBtoLinear(parseInt(hex.slice(0, 2), 16) / 255);
  const g = sRGBtoLinear(parseInt(hex.slice(2, 4), 16) / 255);
  const b = sRGBtoLinear(parseInt(hex.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function sRGBtoLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
