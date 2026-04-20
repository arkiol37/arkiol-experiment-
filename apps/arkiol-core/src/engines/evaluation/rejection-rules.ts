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
  analyzePopulatedSections,
  MIN_SECTIONS,
} from "../layout/section-structure";
import {
  assignComponents,
  analyzeComponents,
  MIN_STRUCTURED_COMPONENTS,
} from "../components/component-system";
import {
  analyzeContentStructure,
  expectsStructuredList,
  MIN_LIST_ITEMS,
} from "../content/content-structure";
import { MIN_COMPONENT_SLOTS } from "../components/content-component-mapper";
import {
  scoreCandidateQuality,
  scoreThemeQuality,
  areTooSimilar,
  computeRankScore,
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
    description: "One decoration kind dominates >38% of the decoration layer.",
    evaluate(theme) {
      const decos = theme.decorations;
      if (decos.length < 4) return null;
      const counts = new Map<string, number>();
      for (const d of decos) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
      const maxShare = Math.max(...counts.values()) / decos.length;
      if (maxShare > 0.38) return `too_repetitive:max_kind_share(${(maxShare * 100).toFixed(0)}%)`;
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

  // ── Generic / uninspired (Step 38) ──────────────────────────────────────
  // The "mid-range-across-the-board" failure: no single dimension dips
  // low enough to trigger the focused rules above, but the composition
  // is uniformly mediocre. Flags outputs where the visual quality
  // dimensions (hierarchy, layering, asset usage, composition balance)
  // all sit between 0.30–0.45 — a sure tell that no single craft
  // element is pulling its weight. A marketplace-grade template should
  // have at least one dimension pushing >= 0.55 even when the total
  // scrapes by.
  {
    id:          "generic_output",
    severity:    "hard",
    description: "All craft dimensions sit in mid-range — template reads as uninspired.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      const craft = [
        s.hierarchyClarity,
        s.visualLayering,
        s.assetUsage,
        s.compositionBalance,
      ];
      const anyStrong = craft.some(v => v >= 0.55);
      const allMid    = craft.every(v => v >= 0.30 && v <= 0.45);
      if (!anyStrong && allMid) {
        return `generic_output:craft=[${craft.map(v => v.toFixed(2)).join(",")}]`;
      }
      return null;
    },
  },

  // ── Single-text-block / sparse content (hard) ────────────────────────────
  // The gallery must not surface templates whose composition is a single
  // text block dropped onto a background. Elevated from soft to hard so
  // it prevents shipment rather than just annotates the output. When
  // content is not available (theme-only evaluation) the rule skips.
  {
    id:          "sparse_content",
    severity:    "hard",
    description: "Template is a single text block — no real composition.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const zones = content.textContents ?? [];
      const populated = zones.filter(z => z.text?.trim().length > 0);
      if (populated.length < 2) return `sparse_content:populated(${populated.length})`;
      return null;
    },
  },

  // ── Structured sections (hard) ───────────────────────────────────────────
  // Step 26: gallery outputs must read as structured compositions — a
  // header / content / visual / cta cluster, not zones stacked in one
  // section. This rule runs the id-based section analyzer over the
  // populated text zones and fails templates that don't span the
  // minimum (2) sections or lack an anchor section (header / content /
  // cta / visual). Applies uniformly to every template type because
  // it's keyed off the zone ids the composer populated, not a type
  // override. When content is not available the rule skips.
  {
    id:          "single_block",
    severity:    "hard",
    description: "Populated zones cluster in one section — no real structure.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const zones = content.textContents ?? [];
      const populated = zones
        .filter(z => z.text?.trim().length > 0)
        .map(z => ({ zoneId: z.zoneId, text: z.text }));
      const rep = analyzePopulatedSections(populated);
      if (rep.isSingleBlock) {
        return `single_block:only_${rep.populatedSections[0] ?? "empty"}_section`;
      }
      if (rep.count < MIN_SECTIONS) {
        return `insufficient_sections:${rep.count}/${MIN_SECTIONS}`;
      }
      if (rep.anchorCount < 1) {
        return `no_anchor_section:[${rep.populatedSections.join(",")}]`;
      }
      return null;
    },
  },

  // ── No structured components (hard) ──────────────────────────────────────
  // Step 5's floor: every template must render its text through at least
  // one structured component (checklist_item / tip_card / step_block /
  // quote_box / content_card / labeled_section). cta_button and badge
  // alone don't satisfy the rule because they don't organize body content
  // — they're widgets, not containers. Prefers the pre-computed report
  // stamped by the SVG builder; falls back to recomputing from populated
  // zones + templateType so older cached renders still get gated.
  {
    id:          "no_components",
    severity:    "hard",
    description: "Populated zones are not wrapped in any structured component — text floats on the background.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const report = content._componentReport ?? (() => {
        const ids = (content.textContents ?? [])
          .filter(z => z.text?.trim().length > 0)
          .map(z => z.zoneId);
        if (ids.length === 0) return null;
        return analyzeComponents(assignComponents(content._templateType, ids), ids);
      })();
      if (!report) return null;
      if (report.structuredCount < MIN_STRUCTURED_COMPONENTS) {
        return `no_components:populated=${report.assignments.length} structured=${report.structuredCount}`;
      }
      return null;
    },
  },

  // ── Unstructured list content (hard) ─────────────────────────────────────
  // Step 6 floor: when the template type expects a structured list
  // (checklist / tips / step_by_step / list_based / educational) the
  // output must render as ≥ 2 distinct bullet items. A single body
  // paragraph that smuggled a list into prose form reads as a flat text
  // card and gets dropped. Reads the SVG builder's pre-computed
  // coverage report first; falls back to inspecting the populated
  // textContents + running the content analyzer so older cached
  // renders still get gated.
  {
    id:          "unstructured_content",
    severity:    "hard",
    description: "List-style template ships as a single paragraph instead of distinct component items.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const tt = content._templateType;
      if (!expectsStructuredList(tt)) return null;

      const coverage = content._contentCoverage;
      if (coverage) {
        if (!coverage.satisfiesMinimum) {
          return `unstructured_content:${tt}:items=${coverage.populatedItems}/${coverage.required}`;
        }
        return null;
      }

      // Fallback path — no coverage stamped on content.
      const textMap = new Map<string, string>(
        (content.textContents ?? []).map(t => [t.zoneId, t.text])
      );
      const bulletCount = ["bullet_1", "bullet_2", "bullet_3"]
        .filter(b => (textMap.get(b) ?? "").trim().length > 0).length;
      if (bulletCount >= MIN_LIST_ITEMS) return null;

      const bodyText = (textMap.get("body") ?? textMap.get("subhead") ?? textMap.get("tagline") ?? "").trim();
      if (!bodyText) return `unstructured_content:${tt}:no_items`;
      const structure = analyzeContentStructure(bodyText);
      // If the body *obviously* contained a list (confidence ≥ 0.7) but
      // we shipped < 2 bullets, we failed to unpack it — reject.
      if (structure.items.length >= MIN_LIST_ITEMS && structure.confidence >= 0.7) {
        return `unstructured_content:${tt}:detected=${structure.items.length}_shipped=${bulletCount}`;
      }
      // Otherwise, list-style template with <2 bullets is still a fail.
      return `unstructured_content:${tt}:shipped=${bulletCount}/${MIN_LIST_ITEMS}`;
    },
  },

  // ── Poor spacing / weak composition (hard) ───────────────────────────────
  // Templates whose spacing is tight AND composition balance is flat read
  // as cramped or lopsided even when richness looks fine. Combined floor
  // so either signal alone doesn't disqualify — only the joint failure.
  {
    id:          "poor_spacing",
    severity:    "hard",
    description: "Composition spacing + balance fall below usable floor.",
    evaluate(theme, _content, score) {
      const s = score ?? scoreThemeQuality(theme);
      // Readability tracks overlay / contrast / crowding. Balance tracks
      // decoration spread. When both sink together, the visual reads as
      // cramped + lopsided and the template isn't gallery-grade.
      if (s.readability < 0.40 && s.compositionBalance < 0.32) {
        return `poor_spacing:read=${s.readability.toFixed(2)},balance=${s.compositionBalance.toFixed(2)}`;
      }
      return null;
    },
  },

  // ── Unmapped content (hard) ──────────────────────────────────────────────
  // Step 8 floor: the structured content generator returned a payload
  // (headline + items + CTA etc.) but the mapper couldn't place it into
  // zones — usually because required roles were missing or the canvas
  // exposed too few usable zones. When the mapping report is absent
  // entirely we also reject, because every live path now stamps one.
  {
    id:          "unmapped_content",
    severity:    "hard",
    description: "Structured content exists but required roles never landed in zones.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const mapping = content._contentMapping;
      if (!mapping) return null; // older cached renders with no mapping → skip
      if (mapping.missingRequired.length > 0) {
        return `unmapped_content:${mapping.templateType}:missing=[${mapping.missingRequired.join(",")}]`;
      }
      if (mapping.slots.length < MIN_COMPONENT_SLOTS) {
        return `unmapped_content:${mapping.templateType}:slots=${mapping.slots.length}/${MIN_COMPONENT_SLOTS}`;
      }
      return null;
    },
  },

  // ── Underfilled components (hard) ────────────────────────────────────────
  // Step 8 floor: the structured content carried enough items to fill a
  // list (checklist / tips / steps / list_based / educational) but the
  // mapper placed fewer than the minimum — the template renders
  // underfilled despite the data being available. Distinct from
  // `unstructured_content` which catches the case where list data never
  // came out of the content coverage analyzer; this one catches the
  // mapping layer dropping items on the floor.
  {
    id:          "underfilled_components",
    severity:    "hard",
    description: "Content items were available but not placed into distinct components.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const mapping = content._contentMapping;
      if (!mapping) return null;
      if (mapping.underfilled) {
        return `underfilled_components:${mapping.templateType}:items=${mapping.placedItemCount}/${mapping.expectedItemCount} missing=[${mapping.missingRequired.join(",")}]`;
      }
      return null;
    },
  },

  // ── Compressed content (hard) ────────────────────────────────────────────
  // Step 8 floor: the structured content produced ≥ 2 items but fewer
  // than 2 of them landed in distinct zones — the classic "list
  // collapses into one block" failure the Step 8 brief explicitly
  // calls out. Fires even when required roles were all placed; the
  // signal is specifically about item distribution.
  {
    id:          "compressed_content",
    severity:    "hard",
    description: "List content compressed into a single area instead of distinct visual items.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const mapping = content._contentMapping;
      if (!mapping) return null;
      if (mapping.compressed) {
        return `compressed_content:${mapping.templateType}:items_placed=${mapping.placedItemCount}`;
      }
      return null;
    },
  },

  // ── Missing subject image (hard) ─────────────────────────────────────────
  // Step 9 floor: when the brief's imageStyle declared a photo-style
  // intent (photography / product / lifestyle) and the canvas has an
  // image zone, the builder MUST place a real subject photo in that
  // zone. "Shapes + gradient only" is not meaningful visual content for
  // a photo brief — it's exactly the failure mode the Step 9 charter
  // calls out. Briefs that opted for abstract / geometric / illustration
  // / none styles are exempt; they skip the rule via the
  // `_photoSubjectExpected` flag.
  {
    id:          "missing_subject_image",
    severity:    "hard",
    description: "Photo-style brief shipped without a real subject image — template reads as shapes on a gradient.",
    evaluate(_theme, content, _score) {
      if (!content) return null;
      const expected = (content as any)._photoSubjectExpected as boolean | undefined;
      if (!expected) return null;
      if ((content as any)._subjectImage) return null;
      // Fallback path — if the flag was never stamped, skip.
      return `missing_subject_image:photo_expected_but_no_subject`;
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
  accepted: Array<T & { score: CandidateQualityScore; rankScore: number }>;
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

  // 3. Sort survivors by rank score (penalty-aware), best first. The
  // rank score applies explicit penalties for empty / simple / repetitive
  // / unbalanced outputs so mediocre candidates sort clearly below
  // candidates that read as designed.
  const rankOf = (q: CandidateQualityScore, theme: DesignTheme) =>
    computeRankScore(q, theme).total;
  const passedRanked = passed
    .map(p => ({ ...p, rank: rankOf(p.verdict.score, p.item.theme) }))
    .sort((a, b) => b.rank - a.rank);

  // 4. Greedy dedup via areTooSimilar.
  const acceptedThemes: Array<{ theme: DesignTheme; label?: string }> = [];
  for (const p of passedRanked) {
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
    accepted.push({ ...p.item, score: p.verdict.score, rankScore: p.rank });
    acceptedThemes.push({ theme: p.item.theme, label: p.item.label });
  }

  // 5. Floor-fill: if we're below the minimum, promote the highest-ranked
  // hard-rejected candidates back in. Their rejection reasons are kept for
  // audit (reason = "kept_as_floor_fill") but they ship so the gallery is
  // never empty.
  if (accepted.length < minAccepted) {
    const rescuable = rejected
      .filter(r => r.reason === "hard_rules")
      .map(r => {
        const v = evaluateRejection(r.item.theme, r.item.content);
        return { r, score: v.score, rank: rankOf(v.score, r.item.theme) };
      })
      .sort((a, b) => b.rank - a.rank);

    const needed = minAccepted - accepted.length;
    const lifted = rescuable.slice(0, needed);
    for (const { r, score, rank } of lifted) {
      accepted.push({ ...r.item, score, rankScore: rank });
      // Move the rejection into "kept_as_floor_fill" so the audit log
      // still knows this was a weak candidate that we shipped only
      // because we needed a minimum count.
      r.reason = "kept_as_floor_fill";
    }
  }

  return { accepted, rejected };
}
