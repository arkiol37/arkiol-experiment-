/**
 * Hybrid Router — v27 Internal-Only
 * ═══════════════════════════════════════════════════════════════════════════════
 * In v27, all 2D and 2.5D scenes are rendered exclusively by the internal
 * Template Execution Engine. The concept of "hybrid" routing (internal vs
 * provider per-scene) is replaced by a uniform internal-only policy.
 *
 * This module preserves the public API surface (planJobRouting,
 * shouldUseInternalEngine, getSceneRoute) for backward compatibility with
 * callers, but all routing decisions now return 'internal'.
 *
 * External providers (Runway/Pika/Sora) are reserved for future 3D video
 * capabilities ONLY and are not integrated into any 2D/2.5D path.
 */

import { logger } from '../../../config/logger';
import type { StoryboardScene, PipelineContext } from '../../types';
import { getAllExecutableTemplates } from '../templates/builtinTemplates';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES (preserved for backward compat)
// ═══════════════════════════════════════════════════════════════════════════════

export type RenderPath = 'internal';

export interface SceneRoutingDecision {
  sceneId: string;
  sceneIndex: number;
  path: 'internal';
  templateId?: string;
  confidence: number;
  reasons: string[];
  fallbackPath: 'internal';
}

export interface JobRoutingPlan {
  renderJobId: string;
  strategy: 'all_internal';
  scenes: SceneRoutingDecision[];
  stats: {
    totalScenes: number;
    internalCount: number;
    providerCount: 0;
    hybridRatio: 1;
  };
}

export interface RouterConfig {
  explicitEngine?: 'internal' | 'provider' | 'auto';
  minConfidence?: number;
  forceInternal?: boolean;
  workspaceInternalEnabled?: boolean;
  platform?: string;
  renderMode?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENE ROLE → TEMPLATE MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

/** All scene roles that have built-in template support. */
const SUPPORTED_ROLES = new Set([
  'hook', 'problem', 'solution', 'proof', 'cta',
  'brand_reveal', 'offer', 'close', 'end',
  'testimonial', 'product_hero', 'text_overlay',
  'split_screen', 'fullscreen_media',
  'intro', 'benefit', 'feature', 'social_proof', 'urgency', 'guarantee',
  // v27: roles that were previously provider-only are now handled internally
  'live_action', 'ai_video', 'product_demo_video', 'cinematic_sequence',
  'generated_footage',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Plan the rendering route for all scenes in a job.
 * In v27, ALL scenes are routed to the internal engine.
 */
export function planJobRouting(
  ctx: PipelineContext,
  config: RouterConfig = {},
): JobRoutingPlan {
  const renderJobId = ctx.renderJobId;
  const renderMode = config.renderMode || 'Normal Ad';

  // Log if caller tried to request provider — it's ignored in v27
  if (config.explicitEngine === 'provider') {
    logger.warn(`[Router] renderEngine='provider' requested but ignored — v27 enforces internal-only for all 2D/2.5D renders`, {
      renderJobId,
      renderMode,
    });
  }

  logger.info(`[Router] Planning internal-only routing for ${ctx.storyboard.length} scenes`, {
    renderJobId,
    renderMode,
    platform: config.platform,
  });

  const allTemplates = getAllExecutableTemplates();

  const sceneDecisions: SceneRoutingDecision[] = ctx.storyboard.map((scene, i) => {
    // Find best matching template
    const matchingTemplate = allTemplates.find(t =>
      t.category === scene.role
      || t.id.includes(scene.role.replace(/[_-]/g, '_'))
    );

    return {
      sceneId: scene.id,
      sceneIndex: i,
      path: 'internal' as const,
      templateId: matchingTemplate?.id,
      confidence: 1.0,
      reasons: [
        `v27 internal-only: all 2D/2.5D scenes use Template Execution Engine`,
        `Role "${scene.role}" → template "${matchingTemplate?.id || 'auto-select'}"`,
      ],
      fallbackPath: 'internal' as const,
    };
  });

  const totalScenes = sceneDecisions.length;

  logger.info(`[Router] Routing plan: all_internal (${totalScenes} scenes)`, { renderJobId });

  return {
    renderJobId,
    strategy: 'all_internal',
    scenes: sceneDecisions,
    stats: {
      totalScenes,
      internalCount: totalScenes,
      providerCount: 0,
      hybridRatio: 1,
    },
  };
}

/**
 * Get the routing decision for a single scene.
 */
export function getSceneRoute(
  plan: JobRoutingPlan,
  sceneId: string,
): SceneRoutingDecision | undefined {
  return plan.scenes.find(d => d.sceneId === sceneId);
}

/**
 * Should this job use the internal engine?
 * In v27, always returns true for 2D/2.5D.
 */
export function shouldUseInternalEngine(
  _ctx: PipelineContext,
  _config: RouterConfig = {},
): boolean {
  return true;
}
