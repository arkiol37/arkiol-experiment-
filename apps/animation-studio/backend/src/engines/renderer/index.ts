/**
 * Template Execution Engine — Public API
 * ═══════════════════════════════════════════════════════════════════════════════
 * Barrel export for the internal rendering runtime.
 *
 * Usage:
 *   import { runInternalRender, bridgeSimpleScene, getTemplateForRole } from '../engines/renderer';
 */

// Core types
export type {
  ExecutableTemplate, TemplateSlot, SceneBindings, SlotBinding,
  CameraBinding, BrandBinding, AudioSyncBinding,
  AnimKeyframe, AnimationSequence, SlotAnimation,
  ResolvedElement, RenderedFrame, SceneClipResult, InternalRenderResult,
  AspectRatio, NormRect, PxRect, BackgroundDef, TextStyle, SlotStyle,
  TransitionType, EasingFn, DepthLayerName,
} from './types';
export { DEPTH_FACTORS } from './types';

// Template registry
export {
  getExecutableTemplate, getAllExecutableTemplates, registerExecutableTemplate,
  getTemplateForRole,
  HOOK_TEMPLATE, PRODUCT_HERO_TEMPLATE, CTA_TEMPLATE,
  TEXT_OVERLAY_TEMPLATE, BRAND_REVEAL_TEMPLATE, TESTIMONIAL_TEMPLATE,
} from './templates/builtinTemplates';

// Integration bridge
export {
  bridgePipelineToRenderer, bridgeSimpleScene,
  type BridgeInput, type BridgeOutput,
} from './integrationBridge';

// Render pipeline
export {
  runInternalRender, renderDirect,
  type InternalRenderOptions,
} from './internalRenderPipeline';

// Scene clip renderer
export {
  renderSceneClip, renderAllSceneClips, renderScenePreview,
  type SceneRenderOptions,
} from './core/sceneClipRenderer';

// Animation timeline
export {
  resolveFrame, computeFrameCount,
  type TimelineConfig,
} from './core/animationTimeline';

// Frame renderer
export {
  renderFrame, renderFrameAsPng,
  type FrameRenderConfig,
} from './core/frameRenderer';

// Asset pipeline
export {
  loadSceneAssets, clearAssetCache, resolveFont, parseColor,
  type LoadedAssets,
} from './assets/assetPipeline';

// Easing
export { applyEasing, lerp, easedLerp, lerpColor } from './core/easing';

// Scene QC validation
export {
  validateRenderedScene, validateAllScenes,
  type SceneQCResult, type QCIssue, type IssueSeverity,
} from './core/sceneQCValidator';

// GIF export
export {
  exportToGif, exportSceneToGif, exportAllScenesToGif,
  type GifExportOptions, type GifExportResult,
} from './core/gifExport';

// Pluggable render backend
export {
  registerBackend, setActiveBackend, getActiveBackend, getBackend, listBackends,
  type RenderBackend, type BackendConfig, type FrameConfig,
} from './core/renderBackend';

// Hybrid router (v27: internal-only enforcement)
export {
  planJobRouting, getSceneRoute, shouldUseInternalEngine,
  type JobRoutingPlan, type SceneRoutingDecision, type RenderPath, type RouterConfig,
} from './hybridRouter';

// Engine gate (v27: blocks external providers for 2D/2.5D)
export {
  enforceInternalRendering, is2D25DMode, getSupportedRenderModes,
  type EngineGateResult,
} from './engineGate';

// Scene spec schema
export {
  SCENE_SPEC_VERSION, validateSceneSpec,
  type SceneSpec, type RenderSpecCollection, type LayerSpec, type LayerContent,
  type BrandSpec, type CameraSpec, type TransitionSpec, type AudioSyncPoint,
} from './schema/sceneSpec';

// Spec builder
export {
  buildRenderSpecs,
  type SpecBuilderInput, type SpecBuilderResult,
} from './schema/specBuilder';

// Layout / constraint engine
export {
  resolveLayout, resolveNormPos, normToPx, pxToNorm, computeShrinkToFit, enforceZOrder,
  CANONICAL_CANVAS_SIZES, PLATFORM_SAFE_AREAS,
  type ResolvedLayout, type ResolvedSlotGeometry, type ConstraintViolation,
} from './layout/constraintEngine';

// Font loader
export {
  loadFontsForScene, resolveFontFallback, buildFontStack, clearFontMemCache,
  BUILT_IN_FONT_FAMILIES, BUILT_IN_FONT_SPECS,
  type FontSpec, type LoadedFont, type FontRegistry,
} from './assets/fontLoader';
