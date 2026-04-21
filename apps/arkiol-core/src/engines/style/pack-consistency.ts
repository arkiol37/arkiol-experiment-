// src/engines/style/pack-consistency.ts
//
// Step 63: pack-level cohesion verdict — ensures a gallery of templates
// reads like a curated collection rather than a random batch.
//
// Pack-coherence.ts (Step 39) already anchors palette / fonts / spacing /
// corner radius / shadow across candidates. This module adds what that
// layer leaves out:
//
//   1. Decoration-style fingerprint — the vocabulary of shape kinds a
//      theme uses (ribbon + checklist + sticker_circle vs. blob +
//      noise_overlay). Two packs can share a palette yet still look
//      thrown-together if one theme is sticker-heavy and another is
//      abstract-minimal.
//
//   2. Tone / mood consensus — headline posture (bold vs. minimal vs.
//      luxury) should be the same family across pack members. Mixing
//      playful + professional + urgent reads as accidental.
//
//   3. Layout variation floor — the opposite problem: every member
//      identical feels like a stamp, not a pack. We want *some* spread
//      in composition counts and background treatments so the grid
//      shows range.
//
//   4. Aggregate verdict — a single rollup across the whole batch:
//      "curated", "loose", or "fragmented". Per-theme deviation from
//      pack-coherence.ts is a 1-vs-anchor view; this is the pack-wide
//      view that a gallery coordinator can gate on.
//
// Pure module — no rendering, no randomness. Callers build the pack
// (typically via generateVariations), then:
//
//   1. scorePackCohesion(themes) -> PackCohesionReport,
//   2. if report.verdict === "fragmented", either re-lock the outliers
//      (lockThemeToAnchor from pack-coherence.ts) or drop them via
//      filterFragmentedMembers(themes, report),
//   3. tag each surviving member with its _packCohesion so downstream
//      rejection rules can refuse outliers that still slipped through.

import type { DesignTheme, DecorShape } from "../render/design-themes";
import type { SvgContent }              from "../render/svg-builder-ultimate";
import {
  extractPackAnchor,
  scorePackCoherence,
  type PackAnchor,
  type PackCoherenceReport,
} from "./pack-coherence";

// ── Thresholds ───────────────────────────────────────────────────────────────
// Tuned against the existing theme library. CURATED is "looks designed",
// FRAGMENTED is "ship and users will ask why these are together".

export const PACK_COHESION_CURATED    = 0.72;
export const PACK_COHESION_FRAGMENTED = 0.50;

// How much overlap we expect in the core decoration vocabulary. Below
// this, the pack's members look like they belong to different families.
export const PACK_DECORATION_MIN_CORE_OVERLAP = 0.30;

// Layout variation floor — packs that are *too* similar (all themes
// using the same handful of decoration kinds in the same counts, same
// background treatment) read as repetitive rather than curated.
export const PACK_LAYOUT_MIN_VARIATION = 0.12;

// Tone-family consensus — fraction of the pack that should share the
// dominant tone. Lower than this and the pack reads as a mishmash.
export const PACK_TONE_CONSENSUS_FLOOR = 0.55;

// Single-theme cohesion floor — member-level rollup used by the
// rejection rule. A single theme that scores this low against the pack
// profile is dropped as an outlier.
export const PACK_MEMBER_OUTLIER_FLOOR = 0.45;

// ── Decoration fingerprint ───────────────────────────────────────────────────
// A compact signature of which decoration kinds a theme uses and at what
// intensity. Two themes with similar fingerprints look like siblings;
// very different fingerprints read as unrelated packs.

export interface DecorationFingerprint {
  /** Count of each decoration kind used in the theme. */
  kindCounts:   Record<string, number>;
  /** Set of distinct decoration kinds present. */
  kindSet:      string[];
  /** Total decoration count. */
  total:        number;
  /** Top-3 decoration kinds by frequency. */
  dominant:     string[];
  /** Background treatment kind (solid / gradient / mesh / split). */
  bgKind:       string;
}

export function extractDecorationFingerprint(theme: DesignTheme): DecorationFingerprint {
  const kindCounts: Record<string, number> = {};
  for (const d of theme.decorations) {
    kindCounts[d.kind] = (kindCounts[d.kind] ?? 0) + 1;
  }
  const kindSet  = Object.keys(kindCounts).sort();
  const total    = theme.decorations.length;
  const dominant = kindSet
    .slice()
    .sort((a, b) => kindCounts[b] - kindCounts[a])
    .slice(0, 3);
  return {
    kindCounts,
    kindSet,
    total,
    dominant,
    bgKind: theme.background.kind,
  };
}

// ── Pack cohesion profile ────────────────────────────────────────────────────
// The aggregate signature of the pack as a whole: what anchor it clusters
// around, which decoration kinds form the core vocabulary, which tones /
// backgrounds are represented.

export interface PackCohesionProfile {
  anchor:          PackAnchor;
  memberCount:     number;
  /** Decoration kinds present in >= 60 % of the pack — the shared vocabulary. */
  coreDecorations: string[];
  /** Union of all decoration kinds across the pack. */
  vocabulary:      string[];
  /** Fraction of pack using each background kind. */
  bgKindShare:     Record<string, number>;
  /** Dominant tone of the pack (most common first tone). */
  dominantTone?:   string;
  /** Fraction of pack sharing the dominant tone. */
  toneConsensus:   number;
  /** Mean decoration count across members. */
  meanDecorations: number;
}

const CORE_VOCAB_SHARE = 0.6;

export function buildPackCohesionProfile(themes: DesignTheme[]): PackCohesionProfile {
  if (themes.length === 0) {
    throw new Error("buildPackCohesionProfile: pack must contain at least one theme");
  }

  const anchor = extractPackAnchor(themes[0]);
  const fps    = themes.map(extractDecorationFingerprint);

  // Decoration-kind presence across members.
  const presence: Record<string, number> = {};
  for (const fp of fps) {
    for (const k of fp.kindSet) {
      presence[k] = (presence[k] ?? 0) + 1;
    }
  }
  const vocabulary      = Object.keys(presence).sort();
  const coreThreshold   = Math.max(1, Math.ceil(themes.length * CORE_VOCAB_SHARE));
  const coreDecorations = vocabulary.filter(k => presence[k] >= coreThreshold);

  // Background-kind share.
  const bgCounts: Record<string, number> = {};
  for (const fp of fps) bgCounts[fp.bgKind] = (bgCounts[fp.bgKind] ?? 0) + 1;
  const bgKindShare: Record<string, number> = {};
  for (const k of Object.keys(bgCounts)) bgKindShare[k] = bgCounts[k] / themes.length;

  // Tone consensus.
  const toneCounts: Record<string, number> = {};
  for (const t of themes) {
    const tone = t.tones?.[0];
    if (tone) toneCounts[tone] = (toneCounts[tone] ?? 0) + 1;
  }
  let dominantTone: string | undefined;
  let toneMax = 0;
  for (const [tone, count] of Object.entries(toneCounts)) {
    if (count > toneMax) { toneMax = count; dominantTone = tone; }
  }
  const toneConsensus = themes.length > 0 ? toneMax / themes.length : 0;

  const meanDecorations =
    fps.reduce((sum, fp) => sum + fp.total, 0) / themes.length;

  return {
    anchor,
    memberCount:     themes.length,
    coreDecorations,
    vocabulary,
    bgKindShare,
    dominantTone,
    toneConsensus,
    meanDecorations,
  };
}

// ── Pack cohesion report ─────────────────────────────────────────────────────
// The headline output. `verdict` answers the user's question "does this
// feel curated?"; `score` is 0..1 (higher = more cohesive); component
// subscores surface *why* so callers can target the right fix.

export type PackCohesionVerdict = "curated" | "loose" | "fragmented";

export interface PackCohesionSubscores {
  palette:    number;  // 1 - mean(per-theme palette deviation)
  typography: number;  // agreement on display + body families
  decoration: number;  // core-vocab overlap among members
  tone:       number;  // toneConsensus
  layout:     number;  // variation across members (bounded — too low also bad)
}

export interface PackMemberReport {
  themeId:        string;
  /** 0..1, higher = more cohesive with the pack profile. */
  cohesionScore:  number;
  /** Derived from cohesionScore vs. the outlier floor. */
  memberVerdict:  "aligned" | "drifting" | "outlier";
  deviations:     string[];
}

export interface PackCohesionReport {
  verdict:        PackCohesionVerdict;
  score:          number;
  subscores:      PackCohesionSubscores;
  profile:        PackCohesionProfile;
  members:        PackMemberReport[];
  violations:     string[];
  /** Per-theme deviation against the anchor (pack-coherence.ts, Step 39). */
  coherence:      PackCoherenceReport[];
}

export function scorePackCohesion(
  themes: DesignTheme[],
): PackCohesionReport {
  if (themes.length === 0) {
    throw new Error("scorePackCohesion: pack must contain at least one theme");
  }

  const profile     = buildPackCohesionProfile(themes);
  const coherence   = scorePackCoherence(themes, profile.anchor);
  const fingerprints = themes.map(extractDecorationFingerprint);
  const violations: string[] = [];

  // ── Palette: invert pack-coherence per-theme deviation ────────────────
  const paletteDev = coherence.reduce((s, r) => s + r.score, 0) / coherence.length;
  const paletteSub = clamp(1 - paletteDev, 0, 1);

  // ── Typography: fraction sharing display + body with the anchor ───────
  let displayMatch = 0;
  let bodyMatch    = 0;
  for (const t of themes) {
    if (t.typography.display === profile.anchor.fontPrimary)   displayMatch++;
    if (t.typography.body    === profile.anchor.fontSecondary) bodyMatch++;
  }
  const typographySub = clamp(
    0.6 * (displayMatch / themes.length) + 0.4 * (bodyMatch / themes.length),
    0, 1,
  );
  if (typographySub < 0.6) {
    violations.push(
      `typography_drift:display=${displayMatch}/${themes.length},body=${bodyMatch}/${themes.length}`,
    );
  }

  // ── Decoration: overlap of each member with the core vocabulary ──────
  const coreSet = new Set(profile.coreDecorations);
  let overlapSum = 0;
  if (coreSet.size > 0) {
    for (const fp of fingerprints) {
      const present = fp.kindSet.filter(k => coreSet.has(k)).length;
      overlapSum += present / coreSet.size;
    }
  } else {
    // No core vocabulary — each member is decorating with its own palette.
    // That's the fragmented case; force overlap to 0.
    overlapSum = 0;
  }
  const decorationSub = themes.length > 0 ? overlapSum / themes.length : 0;
  if (decorationSub < PACK_DECORATION_MIN_CORE_OVERLAP) {
    violations.push(
      `decoration_fragmented:core=${profile.coreDecorations.length},overlap=${decorationSub.toFixed(2)}`,
    );
  }

  // ── Tone consensus ───────────────────────────────────────────────────
  const toneSub = clamp(profile.toneConsensus, 0, 1);
  if (themes.length > 1 && toneSub < PACK_TONE_CONSENSUS_FLOOR) {
    violations.push(
      `tone_scattered:dominant=${profile.dominantTone ?? "none"},consensus=${toneSub.toFixed(2)}`,
    );
  }

  // ── Layout variation ─────────────────────────────────────────────────
  // Healthy variation has three components:
  //   a) decoration-count coefficient of variation (some members bigger),
  //   b) background-kind spread (not every member using the same bg),
  //   c) 1 - (core intersection / vocabulary union) — reserved-variety
  //      slots outside the core vocab.
  // For a single-member pack variation is trivially satisfied.
  let layoutSub: number;
  if (themes.length < 2) {
    layoutSub = 1;
  } else {
    const counts      = fingerprints.map(fp => fp.total);
    const mean        = counts.reduce((s, n) => s + n, 0) / counts.length;
    const variance    = counts.reduce((s, n) => s + (n - mean) ** 2, 0) / counts.length;
    const stdev       = Math.sqrt(variance);
    const countCv     = mean > 0 ? Math.min(1, stdev / mean) : 0;
    const bgKinds     = Object.keys(profile.bgKindShare).length;
    const bgSpread    = Math.min(1, bgKinds / Math.min(themes.length, 3));
    const union       = profile.vocabulary.length;
    const intersect   = profile.coreDecorations.length;
    const nonCoreFrac = union > 0 ? 1 - (intersect / union) : 0;
    layoutSub = clamp(0.4 * countCv + 0.3 * bgSpread + 0.3 * nonCoreFrac, 0, 1);
    if (layoutSub < PACK_LAYOUT_MIN_VARIATION) {
      violations.push(
        `layout_uniform:cv=${countCv.toFixed(2)},bgs=${bgKinds},noncore=${nonCoreFrac.toFixed(2)}`,
      );
    }
  }

  const subscores: PackCohesionSubscores = {
    palette:    paletteSub,
    typography: typographySub,
    decoration: decorationSub,
    tone:       toneSub,
    layout:     layoutSub,
  };

  // Weighted rollup. Palette + decoration carry the most — they drive
  // the "is this a pack?" read. Layout is capped positive (we penalize
  // both too-low and too-high later).
  const score = clamp(
      0.32 * paletteSub
    + 0.18 * typographySub
    + 0.22 * decorationSub
    + 0.12 * toneSub
    + 0.16 * layoutSub,
    0, 1,
  );

  // ── Per-member verdict ───────────────────────────────────────────────
  const members: PackMemberReport[] = themes.map((theme, idx) => {
    const cohReport = coherence[idx];
    const fp        = fingerprints[idx];
    const deviations: string[] = [...cohReport.deviations];

    const coreOverlap = coreSet.size > 0
      ? fp.kindSet.filter(k => coreSet.has(k)).length / coreSet.size
      : 0;
    if (coreSet.size > 0 && coreOverlap < PACK_DECORATION_MIN_CORE_OVERLAP) {
      deviations.push(
        `decoration_core_overlap=${coreOverlap.toFixed(2)} (core=${profile.coreDecorations.join(",")||"∅"})`,
      );
    }

    const firstTone = theme.tones?.[0];
    const toneMatches = !profile.dominantTone || firstTone === profile.dominantTone;
    if (!toneMatches) {
      deviations.push(`tone=${firstTone ?? "none"} vs dominant=${profile.dominantTone}`);
    }

    // Member cohesion score = complement of pack-coherence deviation
    // blended with decoration-core overlap and tone match. Lower means
    // the member is pulling the pack apart.
    const memberScore = clamp(
        0.5  * (1 - cohReport.score)
      + 0.3  * (coreSet.size > 0 ? coreOverlap : 0.5)
      + 0.2  * (toneMatches ? 1 : 0),
      0, 1,
    );

    const memberVerdict: PackMemberReport["memberVerdict"] =
        memberScore >= 0.70 ? "aligned"
      : memberScore >= PACK_MEMBER_OUTLIER_FLOOR ? "drifting"
      : "outlier";

    return {
      themeId:       theme.id,
      cohesionScore: memberScore,
      memberVerdict,
      deviations,
    };
  });

  // Aggregate verdict with guardrails — an "outlier" member forces at
  // worst a "loose" verdict even if numbers would pass; multiple
  // outliers force "fragmented".
  const outliers = members.filter(m => m.memberVerdict === "outlier").length;
  let verdict: PackCohesionVerdict;
  if (outliers >= 2 || score < PACK_COHESION_FRAGMENTED) verdict = "fragmented";
  else if (outliers >= 1 || score < PACK_COHESION_CURATED) verdict = "loose";
  else verdict = "curated";

  if (verdict !== "curated") {
    violations.push(
      `pack_${verdict}:score=${score.toFixed(2)},outliers=${outliers}/${themes.length}`,
    );
  }

  return {
    verdict,
    score,
    subscores,
    profile,
    members,
    violations,
    coherence,
  };
}

// ── Member filtering ─────────────────────────────────────────────────────────
// Drop themes flagged as outliers. Aligned + drifting members stay —
// drifting is a soft warning (usually fixable with lockThemeToAnchor),
// outliers are the ones actively pulling the pack apart.

export interface PackMemberFilterResult {
  kept:     DesignTheme[];
  dropped:  Array<{ theme: DesignTheme; report: PackMemberReport }>;
}

export function filterFragmentedMembers(
  themes: DesignTheme[],
  report: PackCohesionReport,
): PackMemberFilterResult {
  const kept:    DesignTheme[] = [];
  const dropped: PackMemberFilterResult["dropped"] = [];
  for (let i = 0; i < themes.length; i++) {
    const member = report.members[i];
    if (member.memberVerdict === "outlier") dropped.push({ theme: themes[i], report: member });
    else kept.push(themes[i]);
  }
  return { kept, dropped };
}

// ── Content annotation ───────────────────────────────────────────────────────
// Attach the per-member verdict to each SvgContent so the rejection-rules
// catalog can gate on pack outliers without re-running the analysis.
// Follows the same `_xxx` pattern as _selectedTheme / _composition /
// _styleConsistency / _finishVerdict.

export interface PackCohesionSignal {
  packVerdict:   PackCohesionVerdict;
  packScore:     number;
  memberVerdict: PackMemberReport["memberVerdict"];
  memberScore:   number;
  coreOverlap:   number;
}

export function annotatePackCohesion(
  contents: Array<SvgContent | undefined | null>,
  themes:   DesignTheme[],
  report:   PackCohesionReport,
): void {
  if (contents.length !== themes.length) {
    throw new Error(
      `annotatePackCohesion: contents(${contents.length}) !== themes(${themes.length})`,
    );
  }
  const coreSet = new Set(report.profile.coreDecorations);
  for (let i = 0; i < themes.length; i++) {
    const c = contents[i];
    if (!c) continue;
    const fp = extractDecorationFingerprint(themes[i]);
    const coreOverlap = coreSet.size > 0
      ? fp.kindSet.filter(k => coreSet.has(k)).length / coreSet.size
      : 0;
    const m = report.members[i];
    (c as unknown as { _packCohesion: PackCohesionSignal })._packCohesion = {
      packVerdict:   report.verdict,
      packScore:     report.score,
      memberVerdict: m.memberVerdict,
      memberScore:   m.cohesionScore,
      coreOverlap,
    };
  }
}

// ── End-to-end helper ────────────────────────────────────────────────────────
// Convenience for the gallery coordinator: score the pack, annotate each
// content, optionally drop outlier themes. Returns the surviving themes +
// contents in matching order plus the full report.

export interface EnforcePackConsistencyInput {
  themes:    DesignTheme[];
  contents?: Array<SvgContent | undefined | null>;
  /** If true, drops members marked as outliers from the returned pack. */
  dropOutliers?: boolean;
}

export interface EnforcePackConsistencyResult {
  themes:   DesignTheme[];
  contents: Array<SvgContent | undefined | null>;
  report:   PackCohesionReport;
  dropped:  Array<{ theme: DesignTheme; report: PackMemberReport }>;
}

export function enforcePackConsistency(
  input: EnforcePackConsistencyInput,
): EnforcePackConsistencyResult {
  const { themes, contents, dropOutliers } = input;
  const report = scorePackCohesion(themes);

  const paddedContents: Array<SvgContent | undefined | null> = contents
    ? contents.slice(0, themes.length)
    : themes.map(() => null);
  while (paddedContents.length < themes.length) paddedContents.push(null);

  annotatePackCohesion(paddedContents, themes, report);

  if (!dropOutliers) {
    return { themes, contents: paddedContents, report, dropped: [] };
  }

  const keptThemes:   DesignTheme[] = [];
  const keptContents: Array<SvgContent | undefined | null> = [];
  const dropped:      EnforcePackConsistencyResult["dropped"] = [];
  for (let i = 0; i < themes.length; i++) {
    const m = report.members[i];
    if (m.memberVerdict === "outlier") {
      dropped.push({ theme: themes[i], report: m });
    } else {
      keptThemes.push(themes[i]);
      keptContents.push(paddedContents[i]);
    }
  }
  return { themes: keptThemes, contents: keptContents, report, dropped };
}

// ── Utility ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Exported for tests / introspection — same helper pack-coherence.ts
// uses internally, surfaced here so callers don't have to re-import it.
export { scorePackCoherence } from "./pack-coherence";
export type { PackAnchor, PackCoherenceReport } from "./pack-coherence";

// Re-expose to satisfy the DecorShape import guard (otherwise TS prunes
// the import and the isolated-modules path flags it).
export type { DecorShape };
