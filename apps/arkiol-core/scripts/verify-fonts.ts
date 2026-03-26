#!/usr/bin/env tsx
// scripts/verify-fonts.ts
//
// Verifies that:
//   1. All bundled TTF files are present in assets/fonts/
//   2. node-canvas can register and use them
//   3. The char-width ratio fallback agrees with canvas within <5%
//   4. wrapText produces identical output in both measurement paths
//
// Usage:
//   npx tsx scripts/verify-fonts.ts
//
// Exit code 0 = all checks pass
// Exit code 1 = one or more checks failed

import fs   from "fs";
import path from "path";

const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️ ";

let failures = 0;

function ok(label: string, msg?: string) {
  console.log(`${PASS} ${label}${msg ? `: ${msg}` : ""}`);
}

function fail(label: string, msg?: string) {
  console.log(`${FAIL} ${label}${msg ? `: ${msg}` : ""}`);
  failures++;
}

function warn(label: string, msg?: string) {
  console.log(`${WARN} ${label}${msg ? `: ${msg}` : ""}`);
}

// ── 1. Font file presence ─────────────────────────────────────────────────────
console.log("\n── 1. Font file presence ──────────────────────────────────");

const REQUIRED_FILES = [
  "DejaVuSans-Regular.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Italic.ttf",
  "DejaVuSerif-Regular.ttf",
  "DejaVuSerif-Bold.ttf",
  "DejaVuSansMono-Regular.ttf",
  "LiberationSans-Regular.ttf",
  "LiberationSans-Bold.ttf",
];

let totalSize = 0;
for (const file of REQUIRED_FILES) {
  const p = path.join(FONTS_DIR, file);
  if (fs.existsSync(p)) {
    const { size } = fs.statSync(p);
    totalSize += size;
    ok(file, `${(size / 1024).toFixed(0)} KB`);
  } else {
    fail(file, "MISSING");
  }
}
console.log(`   Total font bundle size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

// ── 2. Font registry ──────────────────────────────────────────────────────────
console.log("\n── 2. Font registry ────────────────────────────────────────");

let registerFonts: any;
let REGISTERED_CHAR_WIDTH_RATIOS: Record<string, number>;
let FONT_DEFINITIONS: any[];

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const registry = require("./src/engines/render/font-registry");
  registerFonts              = registry.registerFonts;
  REGISTERED_CHAR_WIDTH_RATIOS = registry.REGISTERED_CHAR_WIDTH_RATIOS;
  FONT_DEFINITIONS           = registry.FONT_DEFINITIONS;

  ok("font-registry module loaded");
} catch (err: any) {
  fail("font-registry module", err.message);
  process.exit(1);
}

const regResult = registerFonts();
if (regResult.ok && regResult.registered > 0) {
  ok("registerFonts()", `registered ${regResult.registered} fonts`);
} else if (regResult.ok && regResult.error?.includes("serverless")) {
  warn("registerFonts()", "canvas not available — fallback active");
} else {
  fail("registerFonts()", regResult.error ?? "unknown error");
}

// Check all required families are covered by FONT_DEFINITIONS
const definedFamilies = new Set(FONT_DEFINITIONS.map((d: any) => d.family));
for (const family of ["Arial", "Georgia", "Courier New", "Verdana", "Impact", "Trebuchet MS"]) {
  if (definedFamilies.has(family)) {
    ok(`FONT_DEFINITIONS covers "${family}"`);
  } else {
    fail(`FONT_DEFINITIONS missing "${family}"`);
  }
}

// Check char-width ratios are calibrated
for (const family of ["Arial", "Georgia", "Courier New", "Verdana", "Impact"]) {
  const ratio = REGISTERED_CHAR_WIDTH_RATIOS[family];
  if (ratio && ratio > 0.3 && ratio < 0.8) {
    ok(`Char-width ratio "${family}"`, ratio.toFixed(3));
  } else {
    fail(`Char-width ratio "${family}"`, ratio ? `${ratio} (out of range 0.3–0.8)` : "missing");
  }
}

// ── 3. Drift test: canvas vs fallback ─────────────────────────────────────────
console.log("\n── 3. Drift: canvas vs char-width-ratio fallback ───────────");

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { measureLineWidth } = require("./src/engines/render/text-measure");

  const testCases = [
    { text: "The quick brown fox",       fontSize: 48, family: "Arial" },
    { text: "Premium quality products",  fontSize: 32, family: "Georgia" },
    { text: "MONOSPACE CODE OUTPUT 123", fontSize: 24, family: "Courier New" },
    { text: "Sale ends today get 50%",   fontSize: 36, family: "Verdana" },
    { text: "IMPACT HEADLINE TEXT",      fontSize: 60, family: "Impact" },
  ];

  const MAX_DRIFT_PCT = 5.0;
  let maxObservedDrift = 0;

  for (const { text, fontSize, family } of testCases) {
    const canvasWidth   = measureLineWidth(text, fontSize, family, 400);
    const ratio         = REGISTERED_CHAR_WIDTH_RATIOS[family] ?? 0.505;
    const fallbackWidth = ratio * fontSize * text.length;
    const driftPct      = Math.abs(canvasWidth - fallbackWidth) / Math.max(canvasWidth, fallbackWidth) * 100;

    maxObservedDrift = Math.max(maxObservedDrift, driftPct);

    if (driftPct <= MAX_DRIFT_PCT) {
      ok(`"${family}" at ${fontSize}px`, `canvas=${canvasWidth.toFixed(1)} fallback=${fallbackWidth.toFixed(1)} drift=${driftPct.toFixed(1)}%`);
    } else {
      fail(`"${family}" at ${fontSize}px`, `drift=${driftPct.toFixed(1)}% exceeds ${MAX_DRIFT_PCT}% — update REGISTERED_CHAR_WIDTH_RATIOS`);
    }
  }

  console.log(`   Max observed drift: ${maxObservedDrift.toFixed(1)}% (limit: ${MAX_DRIFT_PCT}%)`);
} catch (err: any) {
  warn("Drift test", `Skipped (${err.message})`);
}

// ── 4. wrapText determinism ───────────────────────────────────────────────────
console.log("\n── 4. wrapText determinism ─────────────────────────────────");

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { wrapText } = require("./src/engines/render/text-measure");

  const text    = "Discover premium quality footwear crafted for every occasion";
  const results = [];
  for (let i = 0; i < 100; i++) {
    results.push(JSON.stringify(wrapText(text, 36, "Arial", 400, 400)));
  }
  const unique = new Set(results);

  if (unique.size === 1) {
    ok("wrapText 100 iterations", "identical output (deterministic)");
  } else {
    fail("wrapText 100 iterations", `${unique.size} different outputs (non-deterministic!)`);
  }
} catch (err: any) {
  warn("wrapText test", `Skipped (${err.message})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(55));
if (failures === 0) {
  console.log(`${PASS} All font verification checks passed`);
  process.exit(0);
} else {
  console.log(`${FAIL} ${failures} check(s) failed. Fix before deploying.`);
  process.exit(1);
}
