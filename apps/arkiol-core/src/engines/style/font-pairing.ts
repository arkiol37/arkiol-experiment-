// src/engines/style/font-pairing.ts
//
// Curated font-pairing logic.
//
// The previous `resolvePackFont` did a single-axis contrast check (serif vs
// sans) and returned the first candidate that differed from the headline
// classification. That missed everything that actually makes a pair feel
// "designed":
//
//   • Role fitness — Playfair Display is a display serif; using it as body
//     text reads as amateurish. Lato, DM Sans, Nunito are built for body.
//   • Personality alignment — Oswald (industrial/compressed) pairs better
//     with Lato (humanist) than with Nunito Sans (geometric neutral),
//     because the industrial voice calls for a warm counter-voice.
//   • Weight character — an extreme-weight display (Bebas Neue 700-only)
//     wants a quiet body (DM Sans 400), not a second expressive font.
//   • Duplicate-personality avoidance — Montserrat + Poppins are both
//     geometric sans: pairing them reads as "we couldn't choose a font."
//
// This module models fonts as metadata, defines curated canonical pairings
// from typographic literature, and scores candidate pairs with penalties
// for anti-patterns. `selectFontPair` returns the highest-scoring combo
// that satisfies the pack's preferences and the category's personality.

import type { ThemeFont } from "../render/design-themes";

// ── Font metadata ──────────────────────────────────────────────────────────

export type FontClassification = "serif" | "sans" | "display";
export type FontPersonality     =
  | "geometric"    // Montserrat, Poppins, DM Sans, Raleway
  | "humanist"     // Lato, Nunito, Nunito Sans
  | "elegant"      // Playfair Display, Cormorant Garamond
  | "industrial"   // Oswald, Bebas Neue
  | "neutral";     // designed to disappear

export type FontRole = "display-only" | "display-strong" | "flexible" | "body-strong" | "body-only";

export interface FontMetadata {
  font:           ThemeFont;
  classification: FontClassification;
  personality:    FontPersonality;
  /** Role fitness — display-only fonts score poorly as body, body-only as display. */
  role:           FontRole;
  /** Body readability at text sizes (10-18px). 0–1. */
  bodyQuality:    number;
  /** Headline presence at display sizes (48px+). 0–1. */
  displayPower:   number;
  /** Rounded, warm fonts feel softer; geometric/industrial feel harder. 0–1. */
  softness:       number;
}

const FONT_TABLE: Record<ThemeFont, FontMetadata> = {
  "Montserrat":         { font: "Montserrat",         classification: "sans",    personality: "geometric",  role: "flexible",       bodyQuality: 0.72, displayPower: 0.88, softness: 0.40 },
  "Playfair Display":   { font: "Playfair Display",   classification: "serif",   personality: "elegant",    role: "display-only",   bodyQuality: 0.30, displayPower: 0.95, softness: 0.55 },
  "Oswald":             { font: "Oswald",             classification: "sans",    personality: "industrial", role: "display-strong", bodyQuality: 0.45, displayPower: 0.92, softness: 0.15 },
  "Poppins":            { font: "Poppins",            classification: "sans",    personality: "geometric",  role: "flexible",       bodyQuality: 0.75, displayPower: 0.80, softness: 0.60 },
  "Raleway":            { font: "Raleway",            classification: "sans",    personality: "geometric",  role: "display-strong", bodyQuality: 0.55, displayPower: 0.85, softness: 0.50 },
  "Nunito":             { font: "Nunito",             classification: "sans",    personality: "humanist",   role: "body-strong",    bodyQuality: 0.85, displayPower: 0.65, softness: 0.80 },
  "Lato":               { font: "Lato",               classification: "sans",    personality: "humanist",   role: "body-strong",    bodyQuality: 0.92, displayPower: 0.55, softness: 0.55 },
  "Bebas Neue":         { font: "Bebas Neue",         classification: "sans",    personality: "industrial", role: "display-only",   bodyQuality: 0.15, displayPower: 0.95, softness: 0.10 },
  "DM Sans":            { font: "DM Sans",            classification: "sans",    personality: "neutral",    role: "body-strong",    bodyQuality: 0.90, displayPower: 0.68, softness: 0.45 },
  "Cormorant Garamond": { font: "Cormorant Garamond", classification: "serif",   personality: "elegant",    role: "display-only",   bodyQuality: 0.35, displayPower: 0.90, softness: 0.65 },
  "Nunito Sans":        { font: "Nunito Sans",        classification: "sans",    personality: "humanist",   role: "body-strong",    bodyQuality: 0.88, displayPower: 0.60, softness: 0.70 },
};

export function getFontMetadata(font: ThemeFont): FontMetadata {
  return FONT_TABLE[font];
}

// ── Curated canonical pairings ─────────────────────────────────────────────
//
// Literature-backed combinations. Each entry is `[display, body, weight]`:
//  • weight 1.0 = textbook-classic ("Playfair + Lato", "Oswald + Lato")
//  • weight 0.8 = strong editorial
//  • weight 0.6 = workable, context-dependent
//
// `selectFontPair` uses these as the positive score baseline.

interface CanonicalPair { display: ThemeFont; body: ThemeFont; weight: number; }

const CANONICAL_PAIRS: readonly CanonicalPair[] = [
  // Classic editorial (serif display + humanist body)
  { display: "Playfair Display",   body: "Lato",           weight: 1.00 },
  { display: "Playfair Display",   body: "Montserrat",     weight: 0.85 },
  { display: "Playfair Display",   body: "Nunito",         weight: 0.80 },
  { display: "Cormorant Garamond", body: "DM Sans",        weight: 1.00 },
  { display: "Cormorant Garamond", body: "Lato",           weight: 0.95 },
  { display: "Cormorant Garamond", body: "Nunito",         weight: 0.90 },
  { display: "Cormorant Garamond", body: "Nunito Sans",    weight: 0.85 },

  // Industrial display + humanist body
  { display: "Oswald",             body: "Lato",           weight: 1.00 },
  { display: "Oswald",             body: "Nunito",         weight: 0.90 },
  { display: "Oswald",             body: "DM Sans",        weight: 0.85 },
  { display: "Bebas Neue",         body: "DM Sans",        weight: 1.00 },
  { display: "Bebas Neue",         body: "Lato",           weight: 0.95 },
  { display: "Bebas Neue",         body: "Nunito Sans",    weight: 0.85 },

  // Modern workhorse (geometric display + humanist body)
  { display: "Montserrat",         body: "Lato",           weight: 0.95 },
  { display: "Montserrat",         body: "Nunito Sans",    weight: 0.85 },
  { display: "Montserrat",         body: "Nunito",         weight: 0.80 },
  { display: "Raleway",            body: "Lato",           weight: 0.90 },
  { display: "Raleway",            body: "DM Sans",        weight: 0.85 },
  { display: "Raleway",            body: "Nunito",         weight: 0.80 },

  // Friendly rounded (both warm)
  { display: "Poppins",            body: "Nunito",         weight: 0.85 },
  { display: "Poppins",            body: "Lato",           weight: 0.80 },
  { display: "Poppins",            body: "Nunito Sans",    weight: 0.80 },

  // Neutral workhorse — tech/business "safe" options
  { display: "DM Sans",            body: "Lato",           weight: 0.75 },
  { display: "Nunito",             body: "Lato",           weight: 0.70 },
];

// ── Anti-pattern penalties ─────────────────────────────────────────────────

/** Pairs that create the "we couldn't decide" feeling. */
const ANTI_PAIRS: ReadonlySet<string> = new Set([
  // Two display serifs compete
  "Playfair Display|Cormorant Garamond",
  "Cormorant Garamond|Playfair Display",
  // Two industrial compressed sans compete
  "Oswald|Bebas Neue",
  "Bebas Neue|Oswald",
  // Two near-identical geometric sans
  "Montserrat|Poppins",
  "Poppins|Montserrat",
  "Montserrat|DM Sans",
  "DM Sans|Montserrat",
  "Poppins|DM Sans",
  "DM Sans|Poppins",
  // Two humanist sans read as flat
  "Lato|Nunito Sans",
  "Nunito Sans|Lato",
  "Nunito|Nunito Sans",
  "Nunito Sans|Nunito",
  // Raleway thin with Montserrat/Poppins — too similar geometric
  "Raleway|Montserrat",
  "Montserrat|Raleway",
  "Raleway|Poppins",
]);

function pairKey(a: ThemeFont, b: ThemeFont): string { return `${a}|${b}`; }

// ── Pairing score ──────────────────────────────────────────────────────────

export interface PairScore {
  display:  ThemeFont;
  body:     ThemeFont;
  total:    number;
  reasons:  string[];
}

/**
 * Score a candidate (display, body) pair. Higher is better. Negative scores
 * indicate the pair should be avoided.
 *
 * Components:
 *   + canonical match    (up to +1.0)
 *   + role fitness       (display's displayPower, body's bodyQuality)
 *   + classification contrast (serif×sans bonus)
 *   + personality contrast (industrial×humanist, elegant×geometric)
 *   − same font          (-2.0, always disqualifies)
 *   − anti-pair          (-1.0)
 *   − same personality   (-0.3 unless canonical workhorse)
 *   − body-unsuitable body font (penalty scaled by bodyQuality gap)
 */
export function scoreFontPair(display: ThemeFont, body: ThemeFont): PairScore {
  const reasons: string[] = [];
  let score = 0;

  if (display === body) {
    return { display, body, total: -2.0, reasons: ["same font forbidden"] };
  }

  const d = getFontMetadata(display);
  const b = getFontMetadata(body);

  // Canonical
  const canonical = CANONICAL_PAIRS.find(p => p.display === display && p.body === body);
  if (canonical) {
    score += canonical.weight;
    reasons.push(`canonical(${canonical.weight.toFixed(2)})`);
  }

  // Role fitness
  const rolePair = d.displayPower * 0.5 + b.bodyQuality * 0.6;
  score += rolePair;
  reasons.push(`role(dp=${d.displayPower.toFixed(2)},bq=${b.bodyQuality.toFixed(2)})`);

  // Classification contrast (serif × sans)
  if (d.classification !== b.classification) {
    score += 0.35;
    reasons.push("class-contrast");
  }

  // Personality contrast — reward intentional opposites, penalize twins
  if (d.personality !== b.personality) {
    if ((d.personality === "industrial" && b.personality === "humanist") ||
        (d.personality === "elegant"    && b.personality === "humanist") ||
        (d.personality === "elegant"    && b.personality === "neutral") ||
        (d.personality === "industrial" && b.personality === "neutral") ||
        (d.personality === "geometric"  && b.personality === "humanist")) {
      score += 0.30;
      reasons.push(`pers-contrast(${d.personality}/${b.personality})`);
    } else if (d.personality === b.personality) {
      score -= 0.25;
      reasons.push(`pers-match(-0.25)`);
    }
  } else if (!canonical) {
    // Same personality AND not canonical — penalise the flat feel.
    score -= 0.35;
    reasons.push("pers-duplicate(-0.35)");
  }

  // Body font must actually function as body
  if (b.role === "display-only") {
    score -= 0.80;
    reasons.push("body-role-invalid(-0.80)");
  } else if (b.role === "display-strong") {
    score -= 0.25;
    reasons.push("body-role-weak(-0.25)");
  }

  // Display font should project
  if (d.role === "body-only") {
    score -= 0.50;
    reasons.push("display-role-invalid(-0.50)");
  }

  // Hard anti-pair penalty
  if (ANTI_PAIRS.has(pairKey(display, body))) {
    score -= 1.0;
    reasons.push("anti-pair(-1.0)");
  }

  return { display, body, total: score, reasons };
}

// ── Selection ──────────────────────────────────────────────────────────────

export interface FontPairOptions {
  /** Category pack's preferred display fonts (ordered). Optional. */
  preferredDisplay?: readonly ThemeFont[];
  /** Category pack's preferred body fonts (ordered). Optional. */
  preferredBody?:    readonly ThemeFont[];
  /** Theme's default display font (used if no preference list). */
  themeDisplay:      ThemeFont;
  /** Theme's default body font (used if no preference list). */
  themeBody:         ThemeFont;
  /** If the brand locks a display font, pairing honours it verbatim. */
  brandDisplay?:     string;
  /** Softness bias: wellness/beauty want softer; fitness/marketing harder. */
  softnessBias?:     "softer" | "harder" | "neutral";
}

export interface FontPairResult {
  display:  ThemeFont;
  body:     ThemeFont;
  score:    number;
  reasons:  string[];
}

/**
 * Pick the best (display, body) pair given preferences and theme defaults.
 * Strategy:
 *   1. If brandDisplay is set, return it with a curated body partner.
 *   2. Otherwise, score every pair from
 *        displayCandidates × bodyCandidates
 *      and return the highest. If the pack has no preferences, fall back
 *      to the theme defaults.
 *   3. Apply softnessBias as a tie-breaker (+0.15 if bias matches, no
 *      penalty otherwise — bias steers, doesn't override).
 */
export function selectFontPair(opts: FontPairOptions): FontPairResult {
  const displayPool: ThemeFont[] = (opts.preferredDisplay?.length ? [...opts.preferredDisplay] : [opts.themeDisplay]);
  const bodyPool:    ThemeFont[] = (opts.preferredBody?.length    ? [...opts.preferredBody]    : [opts.themeBody]);

  // Always include the theme defaults as viable fallbacks so a pack with a
  // narrow preference list can still find a valid pair.
  if (!displayPool.includes(opts.themeDisplay)) displayPool.push(opts.themeDisplay);
  if (!bodyPool.includes(opts.themeBody))       bodyPool.push(opts.themeBody);

  // Brand override: respect the brand's display font verbatim.
  if (opts.brandDisplay) {
    const brandD = opts.brandDisplay as ThemeFont;
    if (FONT_TABLE[brandD]) {
      const bestBody = pickBestBodyFor(brandD, bodyPool, opts.softnessBias);
      return { display: brandD, body: bestBody.body, score: bestBody.total, reasons: ["brand-display", ...bestBody.reasons] };
    }
    // Unknown brand font — fall through to scoring (brand font not in our set).
  }

  let best: PairScore | null = null;
  for (const d of displayPool) {
    for (const b of bodyPool) {
      const s = scoreFontPair(d, b);
      const biased = applyBias(s, opts.softnessBias);
      if (!best || biased.total > best.total) best = biased;
    }
  }

  // Fallback safety — unreachable unless both pools are empty, but guarded.
  if (!best) {
    return { display: opts.themeDisplay, body: opts.themeBody, score: 0, reasons: ["fallback"] };
  }

  return { display: best.display, body: best.body, score: best.total, reasons: best.reasons };
}

function pickBestBodyFor(
  display:      ThemeFont,
  bodyPool:     ThemeFont[],
  softnessBias: FontPairOptions["softnessBias"],
): PairScore {
  let best: PairScore | null = null;
  for (const b of bodyPool) {
    if (b === display) continue;
    const s = applyBias(scoreFontPair(display, b), softnessBias);
    if (!best || s.total > best.total) best = s;
  }
  // If somehow nothing else is available, return display as body (caller's problem)
  return best ?? scoreFontPair(display, bodyPool[0] ?? display);
}

function applyBias(s: PairScore, bias: FontPairOptions["softnessBias"]): PairScore {
  if (!bias || bias === "neutral") return s;
  const b = getFontMetadata(s.body);
  const d = getFontMetadata(s.display);
  const avgSoftness = (b.softness + d.softness) / 2;
  const biasMatch =
    (bias === "softer" && avgSoftness >= 0.55) ||
    (bias === "harder" && avgSoftness <= 0.45);
  if (biasMatch) {
    return { ...s, total: s.total + 0.15, reasons: [...s.reasons, `softness-bias(+0.15,${bias})`] };
  }
  return s;
}
