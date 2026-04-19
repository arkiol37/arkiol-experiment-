// src/engines/evaluation/marketplace-gate.ts
//
// Final marketplace-quality gate for gallery selection.
//
// Step 25 is the end-of-pipeline check that decides whether a template is
// polished enough to sit next to curated marketplace designs. It stands on
// top of every earlier gate:
//
//   Step 17  visible asset presence           (no text-on-background)
//   Step 22  richer scoring vocabulary        (hierarchy, readability,
//                                              balance, asset usage)
//   Step 23  strict rejection rules           (too_empty, gradient_heavy,
//                                              asset_poor, unbalanced, ...)
//   Step 24  multi-pass auto-refinement       (contrast, overflow,
//                                              clutter, hierarchy fixes)
//
// Those steps fix or reject individual failures. Step 25 asks a harder
// question: does this template read as *marketplace-grade*? It bundles the
// signals into five explicit criteria — polished, layered,
// categorySpecific, assetRich, publishReady — and admits a template to the
// gallery only when every criterion passes. The composite
// "marketplace score" is exposed for ranking the approved set.

import type { DesignTheme }           from "../render/design-themes";
import type { SvgContent }            from "../render/svg-builder-ultimate";
import type { BriefAnalysis }         from "../ai/brief-analyzer";

import {
  scoreCandidateQuality,
  type CandidateQualityScore,
} from "./candidate-quality";
import {
  assessDesignQuality,
  type DesignQualityReport,
} from "./candidate-refinement";
import {
  evaluateRejection,
  type RejectionVerdict,
} from "./rejection-rules";

// ── Criteria vocabulary ──────────────────────────────────────────────────────

export type MarketplaceCriterion =
  | "polished"           // refined + no critical contrast / overflow / spacing
  | "layered"            // real visual depth — layering + bg complexity
  | "categorySpecific"   // tone + colorMood + hierarchy align with brief
  | "assetRich"          // enough library-style assets to read as curated
  | "publishReady";      // composite pass + no hard rejection rule firing

export interface CriterionResult {
  name:     MarketplaceCriterion;
  pass:     boolean;
  actual:   number;              // the most relevant measured signal
  floor:    number;              // the threshold we compared against
  detail:   string;              // one-line human-readable rationale
}

export interface MarketplaceVerdict {
  approved:       boolean;
  criteria:       Record<MarketplaceCriterion, CriterionResult>;
  failedCriteria: MarketplaceCriterion[];
  // Composite marketplace score — used to rank the approved batch.
  marketplaceScore: number;
  qualityScore:     CandidateQualityScore;
}

// ── Thresholds ───────────────────────────────────────────────────────────────
// Tuned so every criterion requires meaningful craft. A template that piled
// on decoration count but kept a flat typography ramp would clear Step 22's
// composite total yet still fail `polished` (spacing floor) or `layered`
// (backgroundComplexity floor) here.

export const MARKETPLACE_THRESHOLDS = {
  polished: {
    contrastCompliance: 0.90,
    overflowRisk:       0.85,
    spacingQuality:     0.70,
  },
  layered: {
    visualLayering:       0.50,
    backgroundComplexity: 0.40,
  },
  categorySpecific: {
    hierarchyClarity: 0.45,
  },
  assetRich: {
    assetUsage:          0.40,
    premiumElements:     0.35,
    decorationDiversity: 0.50,
  },
  publishReady: {
    compositeTotal: 0.58,
  },
} as const;

// Composite score weights. Bias toward the dimensions that most separate
// marketplace work from placeholder-tier output: layering, asset usage,
// hierarchy clarity, readability. The quality total brings in the rest.
export const MARKETPLACE_SCORE_WEIGHTS = {
  quality:          0.30,
  visualLayering:   0.14,
  assetUsage:       0.14,
  hierarchyClarity: 0.10,
  readability:      0.10,
  premiumElements:  0.10,
  compositionBalance: 0.06,
  decorationDiversity: 0.06,
} as const;

// ── Single-template gate ─────────────────────────────────────────────────────

export interface MarketplaceContext {
  theme:              DesignTheme;
  content:            SvgContent;
  zones?:             any;                // Zone[] from layout authority
  format?:            string;
  brief?:             BriefAnalysis;
  refinementPassed?:  boolean;            // true when runRefinementPasses stabilized
  // Pre-computed signals — pass them in if the caller already has them so
  // we avoid re-scoring. All are optional.
  qualityScore?:      CandidateQualityScore;
  designReport?:      DesignQualityReport;
  rejectionVerdict?:  RejectionVerdict;
}

export function passesMarketplaceStandard(ctx: MarketplaceContext): MarketplaceVerdict {
  const q         = ctx.qualityScore     ?? scoreCandidateQuality(ctx.theme, ctx.content);
  const report    = ctx.designReport     ?? (ctx.zones ? assessDesignQuality(ctx.content, ctx.zones, ctx.format) : null);
  const rejection = ctx.rejectionVerdict ?? evaluateRejection(ctx.theme, ctx.content);

  const criteria: Record<MarketplaceCriterion, CriterionResult> =
    {} as Record<MarketplaceCriterion, CriterionResult>;

  // ── polished ────────────────────────────────────────────────────────────
  // A polished template has no critical fix-worthy issues and survived
  // refinement cleanly.
  const tP = MARKETPLACE_THRESHOLDS.polished;
  const contrast = report?.contrastCompliance ?? (q.readability >= 0.6 ? 0.95 : 0.7);
  const overflow = report?.overflowRisk       ?? 0.9;
  const spacing  = report?.spacingQuality     ?? 0.8;
  const polishedRefinedOk = ctx.refinementPassed !== false;
  const polishedPass =
    polishedRefinedOk                 &&
    contrast >= tP.contrastCompliance &&
    overflow >= tP.overflowRisk       &&
    spacing  >= tP.spacingQuality;
  criteria.polished = {
    name:   "polished",
    pass:   polishedPass,
    actual: Math.min(contrast, overflow, spacing),
    floor:  Math.min(tP.contrastCompliance, tP.overflowRisk, tP.spacingQuality),
    detail: `contrast=${contrast.toFixed(2)} overflow=${overflow.toFixed(2)} ` +
            `spacing=${spacing.toFixed(2)} refined=${polishedRefinedOk}`,
  };

  // ── layered ─────────────────────────────────────────────────────────────
  // Real visual depth — the template must stack layers rather than sit
  // flat on a single gradient.
  const tL = MARKETPLACE_THRESHOLDS.layered;
  const layeredPass =
    q.visualLayering       >= tL.visualLayering       &&
    q.backgroundComplexity >= tL.backgroundComplexity;
  criteria.layered = {
    name:   "layered",
    pass:   layeredPass,
    actual: Math.min(q.visualLayering, q.backgroundComplexity),
    floor:  Math.min(tL.visualLayering, tL.backgroundComplexity),
    detail: `layering=${q.visualLayering.toFixed(2)} bg=${q.backgroundComplexity.toFixed(2)}`,
  };

  // ── categorySpecific ────────────────────────────────────────────────────
  // Category fit is inferred from (tone, colorMood) alignment plus the
  // hierarchy floor. A theme whose tones/colorMoods arrays include the
  // brief's own values is at least trying to sit in the right aesthetic
  // neighborhood. If no brief is available we skip the alignment test and
  // rely on hierarchy clarity alone — still meaningful.
  const tC = MARKETPLACE_THRESHOLDS.categorySpecific;
  const hierarchyOk = q.hierarchyClarity >= tC.hierarchyClarity;
  let toneAlignment = true;
  let moodAlignment = true;
  if (ctx.brief) {
    if (Array.isArray(ctx.theme.tones) && ctx.theme.tones.length > 0) {
      toneAlignment = ctx.theme.tones.includes(ctx.brief.tone as any);
    }
    if (Array.isArray(ctx.theme.colorMoods) && ctx.theme.colorMoods.length > 0) {
      moodAlignment = ctx.theme.colorMoods.includes(ctx.brief.colorMood as any);
    }
  }
  const categoryPass = hierarchyOk && toneAlignment && moodAlignment;
  criteria.categorySpecific = {
    name:   "categorySpecific",
    pass:   categoryPass,
    actual: q.hierarchyClarity,
    floor:  tC.hierarchyClarity,
    detail: `hierarchy=${q.hierarchyClarity.toFixed(2)} tone=${toneAlignment} mood=${moodAlignment}`,
  };

  // ── assetRich ───────────────────────────────────────────────────────────
  // Enough library-style assets and variety to read as curated. Overlaps
  // with rejection rule asset_poor but here the floors are higher — poor
  // is the disqualifier; this is the marketplace bar.
  const tA = MARKETPLACE_THRESHOLDS.assetRich;
  const assetPass =
    q.assetUsage          >= tA.assetUsage          &&
    q.premiumElements     >= tA.premiumElements     &&
    q.decorationDiversity >= tA.decorationDiversity;
  criteria.assetRich = {
    name:   "assetRich",
    pass:   assetPass,
    actual: Math.min(q.assetUsage, q.premiumElements, q.decorationDiversity),
    floor:  Math.min(tA.assetUsage, tA.premiumElements, tA.decorationDiversity),
    detail: `asset=${q.assetUsage.toFixed(2)} premium=${q.premiumElements.toFixed(2)} ` +
            `diversity=${q.decorationDiversity.toFixed(2)}`,
  };

  // ── publishReady ────────────────────────────────────────────────────────
  // Composite pass plus no hard rejection rule firing. This is the
  // safety net — even if every other criterion is green, a hard-rejected
  // template cannot ship.
  const tR = MARKETPLACE_THRESHOLDS.publishReady;
  const publishPass = q.total >= tR.compositeTotal && rejection.accept;
  criteria.publishReady = {
    name:   "publishReady",
    pass:   publishPass,
    actual: q.total,
    floor:  tR.compositeTotal,
    detail: `composite=${q.total.toFixed(2)} rejection_accept=${rejection.accept}` +
            (rejection.hardReasons.length > 0
              ? ` hard=[${rejection.hardReasons.slice(0, 2).join("|")}]`
              : ""),
  };

  const failedCriteria: MarketplaceCriterion[] = (
    Object.values(criteria) as CriterionResult[]
  )
    .filter(c => !c.pass)
    .map(c => c.name);

  const approved = failedCriteria.length === 0;
  const marketplaceScore = computeMarketplaceScore(q);

  return {
    approved,
    criteria,
    failedCriteria,
    marketplaceScore,
    qualityScore: q,
  };
}

function computeMarketplaceScore(q: CandidateQualityScore): number {
  const w = MARKETPLACE_SCORE_WEIGHTS;
  return (
    q.total                * w.quality             +
    q.visualLayering       * w.visualLayering      +
    q.assetUsage           * w.assetUsage          +
    q.hierarchyClarity     * w.hierarchyClarity    +
    q.readability          * w.readability         +
    q.premiumElements      * w.premiumElements     +
    q.compositionBalance   * w.compositionBalance  +
    q.decorationDiversity  * w.decorationDiversity
  );
}

// ── Gallery-batch selection ──────────────────────────────────────────────────
// Multi-candidate gallery flow (Step 21) generates several candidates per
// prompt. This runs the marketplace gate against each and returns only
// approved ones, ranked by marketplace score. `minApproved` floor-fills
// from the highest-marketplace-score rejections if too few pass, so the
// gallery is never empty — floor-filled entries keep their verdict for
// audit (approved=false, failedCriteria populated).

export interface MarketplaceSelectionResult<T> {
  approved: Array<{ item: T; verdict: MarketplaceVerdict; floorFilled: boolean }>;
  rejected: Array<{ item: T; verdict: MarketplaceVerdict }>;
}

export interface MarketplaceSelectionOptions {
  minApproved?: number;
}

export function selectMarketplaceApproved<T>(
  candidates: T[],
  extractCtx: (item: T) => MarketplaceContext,
  opts:       MarketplaceSelectionOptions = {},
): MarketplaceSelectionResult<T> {
  const minApproved = Math.max(0, opts.minApproved ?? 0);

  const scored = candidates.map(item => {
    const ctx = extractCtx(item);
    const verdict = passesMarketplaceStandard(ctx);
    return { item, verdict };
  });

  const approvedSet: MarketplaceSelectionResult<T>["approved"] = [];
  const rejectedSet: MarketplaceSelectionResult<T>["rejected"] = [];

  for (const s of scored) {
    if (s.verdict.approved) approvedSet.push({ ...s, floorFilled: false });
    else                    rejectedSet.push(s);
  }

  approvedSet.sort((a, b) => b.verdict.marketplaceScore - a.verdict.marketplaceScore);

  // Floor-fill so the gallery is never empty. Promote the highest-
  // marketplace-score rejections but keep their verdict (audit trail).
  if (approvedSet.length < minApproved) {
    const needed = minApproved - approvedSet.length;
    const fills = rejectedSet
      .slice()
      .sort((a, b) => b.verdict.marketplaceScore - a.verdict.marketplaceScore)
      .slice(0, needed);
    for (const f of fills) {
      approvedSet.push({ item: f.item, verdict: f.verdict, floorFilled: true });
    }
    // Remove floor-filled items from rejected so each item only appears once.
    const filledItems = new Set(fills.map(f => f.item));
    for (let i = rejectedSet.length - 1; i >= 0; i--) {
      if (filledItems.has(rejectedSet[i].item)) rejectedSet.splice(i, 1);
    }
  }

  return { approved: approvedSet, rejected: rejectedSet };
}

// ── Debug helper ─────────────────────────────────────────────────────────────
// One-line summary of a verdict, handy for audit / reasoning logs.

export function describeMarketplaceVerdict(v: MarketplaceVerdict): string {
  const status = v.approved ? "APPROVED" : "REJECTED";
  const score  = v.marketplaceScore.toFixed(2);
  const failed = v.failedCriteria.length > 0 ? ` failed=[${v.failedCriteria.join(",")}]` : "";
  return `marketplace:${status} score=${score}${failed}`;
}
