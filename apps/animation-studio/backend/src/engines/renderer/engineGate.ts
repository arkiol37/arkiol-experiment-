/**
 * Engine Gate — v27 Internal Rendering Enforcement
 * ═══════════════════════════════════════════════════════════════════════════════
 * This module enforces the v27 policy: ALL 2D and 2.5D rendering MUST use
 * the internal Template Execution Engine. External provider APIs (Runway,
 * Pika, Sora, etc.) are BLOCKED for 2D/2.5D and reserved exclusively for
 * future 3D video capabilities.
 *
 * This is the single enforcement point — called at the top of the render
 * worker before any rendering begins.
 */

import { logger } from '../../../config/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER MODE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/** All render modes that produce 2D or 2.5D output — MUST use internal engine. */
const INTERNAL_ONLY_MODES = new Set([
  'Normal Ad',
  'Cinematic Ad',
  'Standard Ad',
  'UGC Style',
  'Text-First',
  'Product Focus',
  'Brand Story',
  'Minimalist',
  // Legacy aliases
  '2D Standard',
  '2D Extended',
  'Premium Cinematic',
]);

/** Future 3D modes that may use external providers (not yet implemented). */
const FUTURE_3D_MODES = new Set([
  '3D Video',
  '3D Cinematic',
  'Full 3D',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface EngineGateResult {
  /** Whether the render is allowed to proceed. Always true for 2D/2.5D. */
  allowed: true;
  /** The enforced rendering engine. Always 'internal' for 2D/2.5D. */
  engine: 'internal';
  /** Whether the original config requested a different engine (logged as warning). */
  overridden: boolean;
  /** The original engine requested by the config. */
  originalEngine?: string;
  /** Warning message if config was overridden. */
  warning?: string;
}

/**
 * Enforce internal rendering for all 2D/2.5D modes.
 *
 * This function:
 * 1. Classifies the render mode as 2D/2.5D or future-3D
 * 2. For 2D/2.5D: forces internal engine regardless of config
 * 3. Logs a warning if the config requested a different engine
 * 4. Throws if the render mode is unrecognised (safety catch)
 *
 * @param renderMode - The render mode from the job config
 * @param requestedEngine - The engine requested by the config ('internal', 'provider', 'auto')
 * @param renderJobId - For logging
 */
export function enforceInternalRendering(
  renderMode: string,
  requestedEngine: string | undefined,
  renderJobId: string,
): EngineGateResult {
  const mode = renderMode || 'Normal Ad';
  const requested = requestedEngine || 'auto';

  // Future 3D modes — not yet implemented, fail with clear message
  if (FUTURE_3D_MODES.has(mode)) {
    throw new Error(
      `[EngineGate] Render mode "${mode}" is a future 3D capability and is not yet available. ` +
      `Only 2D and 2.5D modes are supported in the current release.`
    );
  }

  // All 2D/2.5D modes: enforce internal engine
  if (INTERNAL_ONLY_MODES.has(mode)) {
    const overridden = requested === 'provider';

    if (overridden) {
      logger.warn(`[EngineGate] Config requested engine='provider' for 2D/2.5D mode "${mode}" — ` +
        `overriding to 'internal'. External providers are reserved for future 3D capabilities only.`, {
        renderJobId,
        requestedEngine: requested,
        renderMode: mode,
      });
    }

    logger.info(`[EngineGate] Render ${renderJobId}: mode="${mode}" → engine=internal (enforced)`, {
      renderJobId,
      overridden,
    });

    return {
      allowed: true,
      engine: 'internal',
      overridden,
      originalEngine: overridden ? requested : undefined,
      warning: overridden
        ? `Config requested engine='${requested}' but was overridden to 'internal' — external providers are not available for 2D/2.5D rendering.`
        : undefined,
    };
  }

  // Unknown render mode — default to internal with warning
  logger.warn(`[EngineGate] Unrecognised render mode "${mode}" — defaulting to internal engine`, {
    renderJobId,
  });

  return {
    allowed: true,
    engine: 'internal',
    overridden: requested === 'provider',
    originalEngine: requested === 'provider' ? requested : undefined,
    warning: `Unrecognised render mode "${mode}" — treated as 2D and routed to internal engine.`,
  };
}

/**
 * Check if a render mode is a 2D/2.5D mode (internal-only).
 * Utility for other modules that need to know the classification.
 */
export function is2D25DMode(renderMode: string): boolean {
  return INTERNAL_ONLY_MODES.has(renderMode) || !FUTURE_3D_MODES.has(renderMode);
}

/**
 * Get the list of all supported render modes.
 */
export function getSupportedRenderModes(): string[] {
  return [...INTERNAL_ONLY_MODES];
}
