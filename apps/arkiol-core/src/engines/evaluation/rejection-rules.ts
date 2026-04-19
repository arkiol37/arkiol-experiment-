// src/engines/evaluation/rejection-rules.ts
// Strict rejection gate for gallery candidates.
//
// Step 23 consolidates every reason we would filter a template out of the
// gallery flow into one named-rule catalog. Previous checks (isBland,
// checkMarketplaceQuality, areTooSimilar) lived in candidate-quality.ts
// and were used ad-hoc. This module:
//   - surfaces every rule with a stable id + severity + description
//   - evaluates a single theme/content pair end-to-end
//   - batch-filters a list of candidates (dedups near-duplicates,
//     drops hard-rejected outputs, keeps a minimum acceptance floor)
//
// The goal is aggressive: weak outputs should not appear in the gallery.
// The batch filter runs inside the multi-candidate gallery flow (Step 21)
// so each prompt's candidate pool is pruned before the user sees it.

import type { DesignTheme } from "../render/design-themes";
import type { SvgContent }  from "../render/svg-builder-ultimate";
import {
  scoreCandidateQuality,
  scoreThemeQuality,
  areTooSimilar,
  type CandidateQualityScore,
} from "./candidate-quality";

// ── Rule shape ───────────────────────────────────────────────────────────────

export type RejectionSeverity = "hard" | "soft";

export interface RejectionRule {
  id:          string;
  severity:    RejectionSeverity;
  description: string;
  // Predicate. Returns a reason message when the rule fires, else null.
  // `score` is the composed quality score if the caller has one; the
  // helpers below compute it on demand when it's not provided.
  evaluate: (
    theme:    DesignTheme,
    content?: SvgContent,
    score?:   CandidateQualityScore,
  ) => string | null;
}

export interface RejectionVerdict {
  accept:      boolean;              // true iff no hard rule fires
  hardReasons: string[];
  softReasons: string[];
  score:       CandidateQualityScore;
}

// ── Rule catalog ─────────────────────────────────────────────────────────────
// Thresholds are intentionally aggressive — Step 23's charter is "weak
// gallery outputs stop appearing". Callers that want a softer gate can
// consult soft rules separately.

// Premium / library-style shapes. Mirrors PREMIUM + asset-usage kinds in
// candidate-quality.ts; kept local so the rule catalog stays self-
// contained and tuning here doesn't require editing two files.
const LIBRARY_STYLE_KINDS = new Set<string>([
  "ribbon", "sticker_circle", "icon_symbol", "checklist", "frame_border",
  "section_divider", "texture_fill", "photo_circle", "starburst",
  "price_tag", "banner_strip", "badge_pill", "card_panel", "deco_ring",
  "accent_bar", "corner_bracket",
]);

export const REJECTION_RULES: RejectionRule[] = [
  // ── Too empty ────────────────────────────────────────────────────────────
  {
    id:          "too_empty",
    severity:    "hard",
    description: "Decoration layer is too thin — template reads as a bare card.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      const decoCount = theme.decorations.length;
      if (decoCount < 5)                                return `too_empty:decorations(${decoCount})`;
      if (s.visualLayering < 0.15 && s.assetUsage < 0.2) return `too_empty:no_layering(${s.visualLayering.toFixed(2)})`;
      return null;
    },
  },

  // ── Too repetitive ───────────────────────────────────────────────────────
  {
    id:          "too_repetitive",
    severity:    "hard",
    description: "One decoration kind dominates >40% of the decoration layer.",
    evaluate(theme) {
      const decos = theme.decorations;
      if (decos.length < 4) return null;
      const counts = new Map<string, number>();
      for (const d of decos) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
      const maxShare = Math.max(...counts.values()) / decos.length;
      if (maxShare > 0.40) return `too_repetitive:max_kind_share(${(maxShare * 100).toFixed(0)}%)`;
      return null;
    },
  },

  // ── Gradient-only ────────────────────────────────────────────────────────
  {
    id:          "gradient_heavy",
    severity:    "hard",
    description: "Background is a plain gradient without supporting richness signals.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      const bg = theme.background.kind;
      if (bg !== "linear_gradient" && bg !== "solid") return null;

      // Gradient / solid background + no premium / asset-usage signal +
      // weak layering = the classic "text on a gradient" failure mode.
      if (s.premiumElements < 0.15 &&
          s.assetUsage      < 0.18 &&
          s.visualLayering  < 0.30) {
        return `gradient_heavy:bg=${bg},premium=${s.premiumElements.toFixed(2)},asset=${s.assetUsage.toFixed(2)}`;
      }
      return null;
    },
  },

  // ── Asset-poor ───────────────────────────────────────────────────────────
  {
    id:          "asset_poor",
    severity:    "hard",
    description: "Too few library-style decorations — generic shapes dominate.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      const libCount = theme.decorations.filter(d => LIBRARY_STYLE_KINDS.has(d.kind)).length;
      if (s.assetUsage < 0.18 && libCount < 2) {
        return `asset_poor:library=${libCount},score=${s.assetUsage.toFixed(2)}`;
      }
      return null;
    },
  },

  // ── Visually weak ────────────────────────────────────────────────────────
  {
    id:          "visually_weak",
    severity:    "hard",
    description: "Composite quality score below the marketplace floor.",
    evaluate(theme, content, score) {
      const s = score ?? (content ? scoreCandidateQuality(theme, content) : scoreThemeQuality(theme));
      if (s.total < 0.52) return `visually_weak:total(${s.total.toFixed(2)})`;
      return null;
    },
  },

  // ── Weak hierarchy ───────────────────────────────────────────────────────
  {
    id:          "weak_hierarchy",
    severity:    "hard",
    description: "Typographic hierarchy is flat — no clear reading order.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      if (s.hierarchyClarity < 0.28) return `weak_hierarchy:score(${s.hierarchyClarity.toFixed(2)})`;
      return null;
    },
  },

  // ── Unreadable ───────────────────────────────────────────────────────────
  {
    id:          "unreadable",
    severity:    "hard",
    description: "Text would not read cleanly — no overlay / low contrast / crowded zones.",
    evaluate(theme, content, score) {
      const s = score ?? (content ? scoreCandidateQuality(theme, content) : scoreThemeQuality(theme));
      if (s.readability < 0.32) return `unreadable:score(${s.readability.toFixed(2)})`;
      return null;
    },
  },

  // ── Unbalanced ───────────────────────────────────────────────────────────
  {
    id:          "unbalanced",
    severity:    "hard",
    description: "Decorations cluster in one region instead of composing the canvas.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      if (s.compositionBalance < 0.22) return `unbalanced:score(${s.compositionBalance.toFixed(2)})`;
      return null;
    },
  },

  // ── Sparse content (soft) ────────────────────────────────────────────────
  {
    id:          "sparse_content",
    severity:    "soft",
    description: "Core text zones (headline / subhead / cta) under-populated.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const zones = content.textContents ?? [];
      const populated = zones.filter(z => z.text?.trim().length > 0);
      if (populated.length < 2) return `sparse_content:populated(${populated.length})`;
      return null;
    },
  },

  // ── Low diversity (soft) ─────────────────────────────────────────────────
  {
    id:          "low_diversity",
    severity:    "soft",
    description: "Few distinct decoration kinds — template may feel monotonous.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      if (s.decorationDiversity < 0.25) return `low_diversity:score(${s.decorationDiversity.toFixed(2)})`;
      return null;
    },
  },
];

// ── Single-candidate evaluation ──────────────────────────────────────────────

/**
 * Run every rule against one theme (+ optional content). Returns an
 * explicit verdict: accept/reject plus every reason that fired. `score` is
 * computed once and passed to each rule to avoid re-scoring.
 */
export function evaluateRejection(
  theme:    DesignTheme,
  content?: SvgContent,
): RejectionVerdict {
  const score: CandidateQualityScore = content
    ? scoreCandidateQuality(theme, content)
    : scoreThemeQuality(theme);

  const hardReasons: string[] = [];
  const softReasons: string[] = [];

  for (const rule of REJECTION_RULES) {
    const reason = rule.evaluate(theme, content, score);
    if (!reason) continue;
    if (rule.severity === "hard") hardReasons.push(reason);
    else                          softReasons.push(reason);
  }

  return {
    accept: hardReasons.length === 0,
    hardReasons,
    softReasons,
    score,
  };
}

// ── Batch filtering ──────────────────────────────────────────────────────────
// The gallery flow generates multiple candidates per prompt (Step 21). The
// batch filter runs after all candidates are built:
//   1. Drop hard-rejected outputs.
//   2. Sort survivors by composite score (best first).
//   3. Greedily dedup near-duplicates (keep the best; drop later ones that
//      are too similar via areTooSimilar).
//   4. Optionally enforce a minAccepted floor — if too many are dropped,
//      allow the best-of-rejected back in with a "soft_override" reason so
//      the UI never shows an empty gallery.

export interface BatchFilterItem {
  theme:    DesignTheme;
  content?: SvgContent;
  label?:   string;   // optional id / variation tag the caller uses
}

export interface BatchFilterResult<T extends BatchFilterItem> {
  accepted: Array<T & { score: CandidateQualityScore }>;
  rejected: Array<{
    item:      T;
    reasons:   string[];
    soft:      string[];
    reason:    "hard_rules" | "near_duplicate" | "kept_as_floor_fill";
    similarTo?: string;      // label of the item this one was a near-dup of
  }>;
}

export interface BatchFilterOptions {
  // Minimum number of candidates the gallery should contain after
  // filtering. Set to 0 to disable floor-filling.
  minAccepted?:    number;
  // Cap on how many duplicates to allow before rejecting a similar item.
  // Default: 0 — first accepted wins, every later similar is rejected.
  similarityCap?:  number;
}

export function filterCandidateBatch<T extends BatchFilterItem>(
  items: T[],
  opts:  BatchFilterOptions = {},
): BatchFilterResult<T> {
  const minAccepted   = Math.max(0, opts.minAccepted ?? 1);
  const similarityCap = Math.max(0, opts.similarityCap ?? 0);

  // 1. Evaluate every candidate up-front.
  const verdicts = items.map((item, idx) => {
    const v = evaluateRejection(item.theme, item.content);
    return { item, idx, verdict: v };
  });

  const accepted: BatchFilterResult<T>["accepted"] = [];
  const rejected: BatchFilterResult<T>["rejected"] = [];

  // 2. Apply hard rules.
  const passed = verdicts.filter(v => {
    if (!v.verdict.accept) {
      rejected.push({
        item:    v.item,
        reasons: v.verdict.hardReasons,
        soft:    v.verdict.softReasons,
        reason:  "hard_rules",
      });
      return false;
    }
    return true;
  });

  // 3. Sort survivors by composite score, best first.
  passed.sort((a, b) => b.verdict.score.total - a.verdict.score.total);

  // 4. Greedy dedup via areTooSimilar.
  const acceptedThemes: Array<{ theme: DesignTheme; label?: string }> = [];
  for (const p of passed) {
    const dupIndex = acceptedThemes.findIndex(a => areTooSimilar(a.theme, p.item.theme));
    if (dupIndex !== -1 && acceptedThemes.length - dupIndex > similarityCap) {
      rejected.push({
        item:      p.item,
        reasons:   [`near_duplicate:${acceptedThemes[dupIndex].label ?? "prior"}`],
        soft:      p.verdict.softReasons,
        reason:    "near_duplicate",
        similarTo: acceptedThemes[dupIndex].label,
      });
      continue;
    }
    accepted.push({ ...p.item, score: p.verdict.score });
    acceptedThemes.push({ theme: p.item.theme, label: p.item.label });
  }

  // 5. Floor-fill: if we're below the minimum, promote the highest-scoring
  // hard-rejected candidates back in. Their rejection reasons are kept for
  // audit (reason = "kept_as_floor_fill") but they ship so the gallery is
  // never empty.
  if (accepted.length < minAccepted) {
    const rescuable = rejected
      .filter(r => r.reason === "hard_rules")
      .map(r => ({
        r,
        score: evaluateRejection(r.item.theme, r.item.content).score,
      }))
      .sort((a, b) => b.score.total - a.score.total);

    const needed = minAccepted - accepted.length;
    const lifted = rescuable.slice(0, needed);
    for (const { r, score } of lifted) {
      accepted.push({ ...r.item, score });
      // Move the rejection into "kept_as_floor_fill" so the audit log
      // still knows this was a weak candidate that we shipped only
      // because we needed a minimum count.
      r.reason = "kept_as_floor_fill";
    }
  }

  return { accepted, rejected };
}
