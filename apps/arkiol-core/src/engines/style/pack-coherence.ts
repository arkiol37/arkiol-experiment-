// src/engines/style/pack-coherence.ts
//
// Pack-level style coherence for the gallery candidate flow (Step 21).
//
// When a single prompt spawns N candidate templates, the user expects
// them to feel like one curated pack — same palette family, same
// typography system, same spacing rhythm — while still varying in
// layout and composition. The existing multi-output StyleAnchor solves
// this for campaigns (several formats sharing a narrative). PackAnchor
// is the lighter-weight analogue for the within-format candidate batch:
// fewer fields, no campaign-narrative dependency, easy to snapshot from
// the first successful theme and apply to the rest.
//
// This module is pure — no rendering, no generation. Callers:
//   1. pick a reference theme (typically the first approved candidate),
//   2. extractPackAnchor(theme)  -> PackAnchor,
//   3. for each remaining candidate, lockThemeToAnchor(theme, anchor)
//      to align palette / typography / spacing / corner radius,
//   4. scorePackCoherence(themes, anchor) to verify deviation stays
//      under the configured tolerance before shipping the pack.

import type { DesignTheme, ThemeFont, ThemePalette } from "../render/design-themes";

// ── Pack anchor ──────────────────────────────────────────────────────────────
// The *minimum* set of style traits a pack must share. Intentionally
// narrower than multi-output's StyleAnchor (which carries tone /
// composition / hook strategy too) — PackAnchor is just "what should
// look the same across the gallery grid".

export interface PackAnchor {
  // Palette anchor — primary + accent + surface + ink. The rest of the
  // palette (highlight, textMuted) can vary per-candidate for visual
  // interest.
  palette: {
    primary:    string;
    accent:     string;
    surface:    string;
    ink:        string;
  };
  // Typography anchor — display + body font families. Individual
  // weights / sizes are allowed to vary, but the family must match.
  fontPrimary:   ThemeFont;
  fontSecondary: ThemeFont;
  // Grid / spacing rhythm. 4 or 8 px is the common design-system
  // choice; a pack should pick one and stick to it so margins / gaps
  // / padding read as intentional.
  spacingUnit:   number;
  // Visual-language anchors — corner radius + shadow intensity — so
  // all cards / buttons / ribbons in the pack share curvature and
  // elevation feel.
  cornerRadius:  number;
  shadowProfile: "soft" | "medium" | "strong";
}

// ── Extraction ───────────────────────────────────────────────────────────────

const DEFAULT_SPACING_UNIT  = 8;
const DEFAULT_CORNER_RADIUS = 12;

export function extractPackAnchor(theme: DesignTheme): PackAnchor {
  return {
    palette: {
      primary: theme.palette.primary,
      accent:  theme.palette.secondary,
      surface: theme.palette.background,
      ink:     theme.palette.text,
    },
    fontPrimary:   theme.typography.display,
    fontSecondary: theme.typography.body,
    // DesignTheme doesn't carry an explicit spacing unit today —
    // 8 is the project default and matches the grid helpers in
    // engines/layout/artboard-grid.ts. Callers that already track a
    // different unit should use extractPackAnchorFrom() below.
    spacingUnit:   DEFAULT_SPACING_UNIT,
    // CTA border radius is the best proxy for the theme's overall
    // curvature language. Falls back to a neutral 12px.
    cornerRadius:  theme.ctaStyle.borderRadius > 0
                     ? Math.round(theme.ctaStyle.borderRadius)
                     : DEFAULT_CORNER_RADIUS,
    shadowProfile: inferShadowProfile(theme),
  };
}

export function extractPackAnchorFrom(
  theme:       DesignTheme,
  overrides:   Partial<PackAnchor> = {},
): PackAnchor {
  return { ...extractPackAnchor(theme), ...overrides };
}

function inferShadowProfile(theme: DesignTheme): PackAnchor["shadowProfile"] {
  if (theme.ctaStyle.shadow === true) return "medium";
  // Tone → shadow profile map. Uses the BriefAnalysis tone axis
  // (professional / playful / urgent / warm / bold / minimal / luxury
  // / energetic) because that's what DesignTheme.tones carries.
  const tone = theme.tones?.[0];
  if (tone === "luxury" || tone === "bold" || tone === "urgent") return "strong";
  if (tone === "minimal" || tone === "professional")             return "soft";
  return "medium";
}

// ── Apply (lock) ─────────────────────────────────────────────────────────────
// lockThemeToAnchor returns a *new* theme object with palette / fonts /
// ctaStyle overridden to match the anchor. Doesn't mutate the input.
// Decorations, composition, and typography per-zone overrides stay
// intact — only the *shared* traits are pulled into line.

export function lockThemeToAnchor(
  theme:  DesignTheme,
  anchor: PackAnchor,
): DesignTheme {
  const palette: ThemePalette = {
    ...theme.palette,
    primary:    anchor.palette.primary,
    secondary:  anchor.palette.accent,
    background: anchor.palette.surface,
    text:       anchor.palette.ink,
  };
  return {
    ...theme,
    palette,
    typography: {
      ...theme.typography,
      display: anchor.fontPrimary,
      body:    anchor.fontSecondary,
    },
    ctaStyle: {
      ...theme.ctaStyle,
      borderRadius: anchor.cornerRadius,
      shadow: anchor.shadowProfile !== "soft",
    },
  };
}

// ── Coherence scoring ────────────────────────────────────────────────────────
// Per-theme deviation score against the anchor. Lower is better; 0
// means perfect lock, 1.0 means every shared trait deviates. Callers
// that want a pass/fail can check against PACK_COHERENCE_FLOOR.

export const PACK_COHERENCE_FLOOR = 0.35;

export interface PackCoherenceReport {
  score:         number;           // 0..1, lower = more coherent
  themeId:       string;
  deviations:    string[];         // human-readable per-trait notes
}

export function scorePackCoherence(
  themes: DesignTheme[],
  anchor: PackAnchor,
): PackCoherenceReport[] {
  return themes.map(theme => scoreSingleCoherence(theme, anchor));
}

function scoreSingleCoherence(
  theme:  DesignTheme,
  anchor: PackAnchor,
): PackCoherenceReport {
  const deviations: string[] = [];
  let score = 0;

  // Palette primary + accent mismatches carry the most weight — they
  // drive the whole visual identity.
  if (normalizeColor(theme.palette.primary) !== normalizeColor(anchor.palette.primary)) {
    score += 0.35;
    deviations.push(`primary=${theme.palette.primary} vs anchor=${anchor.palette.primary}`);
  }
  if (normalizeColor(theme.palette.secondary) !== normalizeColor(anchor.palette.accent)) {
    score += 0.20;
    deviations.push(`accent=${theme.palette.secondary} vs anchor=${anchor.palette.accent}`);
  }
  if (normalizeColor(theme.palette.background) !== normalizeColor(anchor.palette.surface)) {
    score += 0.15;
    deviations.push(`surface=${theme.palette.background} vs anchor=${anchor.palette.surface}`);
  }

  // Font mismatches — display + body families should match.
  if (theme.typography.display !== anchor.fontPrimary) {
    score += 0.15;
    deviations.push(`display font=${theme.typography.display} vs anchor=${anchor.fontPrimary}`);
  }
  if (theme.typography.body !== anchor.fontSecondary) {
    score += 0.10;
    deviations.push(`body font=${theme.typography.body} vs anchor=${anchor.fontSecondary}`);
  }

  // Corner radius — up to 6px drift is fine; beyond that the curvature
  // language reads differently.
  const radiusDelta = Math.abs(theme.ctaStyle.borderRadius - anchor.cornerRadius);
  if (radiusDelta > 6) {
    score += Math.min(0.10, radiusDelta / 60);
    deviations.push(`cornerRadius=${theme.ctaStyle.borderRadius} vs anchor=${anchor.cornerRadius} (Δ${radiusDelta})`);
  }

  // Shadow profile mismatch — soft vs strong is a visible pack break.
  const themeShadowProfile = inferShadowProfile(theme);
  if (themeShadowProfile !== anchor.shadowProfile) {
    // Adjacent levels (soft↔medium, medium↔strong) are only a mild
    // deviation; soft↔strong is a bigger break.
    const dist = Math.abs(
      shadowProfileLevel(themeShadowProfile) - shadowProfileLevel(anchor.shadowProfile),
    );
    score += dist * 0.05;
    deviations.push(`shadow=${themeShadowProfile} vs anchor=${anchor.shadowProfile}`);
  }

  return {
    score:   Math.min(1, score),
    themeId: theme.id,
    deviations,
  };
}

function shadowProfileLevel(p: PackAnchor["shadowProfile"]): number {
  return p === "soft" ? 0 : p === "medium" ? 1 : 2;
}

function normalizeColor(c: string): string {
  return c.toLowerCase().replace(/\s/g, "");
}

// ── Coherence gate ───────────────────────────────────────────────────────────
// Convenience: filter a batch to themes that clear the coherence floor.
// Themes above the floor are still returned but flagged so callers can
// log / retry them through lockThemeToAnchor before shipping.

export interface CoherenceFilterResult {
  coherent:     DesignTheme[];
  incoherent:   Array<{ theme: DesignTheme; report: PackCoherenceReport }>;
}

export function filterCoherentPack(
  themes: DesignTheme[],
  anchor: PackAnchor,
  floor:  number = PACK_COHERENCE_FLOOR,
): CoherenceFilterResult {
  const coherent:   DesignTheme[] = [];
  const incoherent: CoherenceFilterResult["incoherent"] = [];

  for (const theme of themes) {
    const report = scoreSingleCoherence(theme, anchor);
    if (report.score <= floor) coherent.push(theme);
    else                        incoherent.push({ theme, report });
  }
  return { coherent, incoherent };
}
