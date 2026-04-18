// src/engines/intelligence/strategy-applier.ts
//
// Applies the adaptive strategy computed by the creative intelligence loop
// back into the generation pipeline. Converts high-level strategy decisions
// (blacklists, quality floors, exploration budgets) into concrete overrides
// that the SVG builder and theme selection can consume.

import type { AdaptiveStrategy } from "./creative-loop";
import { computeAdaptiveStrategy } from "./creative-loop";

// ── Strategy-derived theme filter ──────────────────────────────────────────
// Used by svg-builder-ultimate to filter candidate themes before selection.

export interface ThemeFilter {
  blacklist: Set<string>;
  whitelist: Set<string>;
  hasBlacklist: boolean;
  hasWhitelist: boolean;
}

export function buildThemeFilter(strategy: AdaptiveStrategy): ThemeFilter {
  return {
    blacklist: new Set(strategy.themeBlacklist),
    whitelist: new Set(strategy.themeWhitelist),
    hasBlacklist: strategy.themeBlacklist.length > 0,
    hasWhitelist: strategy.themeWhitelist.length > 0,
  };
}

export function isThemeAllowed(themeId: string, filter: ThemeFilter): boolean {
  if (filter.hasBlacklist && filter.blacklist.has(themeId)) return false;
  return true;
}

export function isThemePreferred(themeId: string, filter: ThemeFilter): boolean {
  if (filter.hasWhitelist && filter.whitelist.has(themeId)) return true;
  return false;
}

// ── Quality gate adjustment ────────────────────────────────────────────────
// Adapts the quality retry threshold based on learned performance.

export interface QualityGateConfig {
  retryThreshold: number;
  designQualityFloor: number;
  candidateCount: number;
}

export function buildQualityGateConfig(strategy: AdaptiveStrategy): QualityGateConfig {
  return {
    retryThreshold: strategy.qualityFloor,
    designQualityFloor: Math.max(0.40, strategy.qualityFloor + 0.10),
    candidateCount: strategy.variationCount,
  };
}

// ── Exploration budget config ──────────────────────────────────────────────
// Controls how much the system explores new styles vs. exploiting proven ones.

export interface ExplorationConfig {
  budget: number;
  highConfidenceRatio: number;
  preferredLayouts: string[];
}

export function buildExplorationConfig(strategy: AdaptiveStrategy): ExplorationConfig {
  return {
    budget: strategy.explorationBudget,
    highConfidenceRatio: 1.0 - strategy.explorationBudget,
    preferredLayouts: strategy.layoutPreferences,
  };
}

// ── Combined generation context ────────────────────────────────────────────
// Single object combining all strategy-derived overrides for pipeline use.

export interface IntelligenceContext {
  active: boolean;
  themeFilter: ThemeFilter;
  qualityGate: QualityGateConfig;
  exploration: ExplorationConfig;
  strategy: AdaptiveStrategy;
}

export function buildIntelligenceContext(
  format?: string,
): IntelligenceContext {
  const strategy = computeAdaptiveStrategy(format);
  return {
    active: true,
    themeFilter: buildThemeFilter(strategy),
    qualityGate: buildQualityGateConfig(strategy),
    exploration: buildExplorationConfig(strategy),
    strategy,
  };
}
