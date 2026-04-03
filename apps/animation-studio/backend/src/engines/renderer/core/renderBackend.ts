/**
 * Renderer Backend Interface
 * ═══════════════════════════════════════════════════════════════════════════════
 * Abstraction layer that decouples the template/animation system from the
 * specific pixel-producing backend.
 *
 * The current implementation uses Sharp (libvips). This interface makes it
 * possible to swap in Canvas (node-canvas/Skia), WebGL, Remotion, or any
 * other rendering backend without rewriting the template system, animation
 * timeline, asset pipeline, or integration bridge.
 *
 * To add a new backend:
 *   1. Implement the RenderBackend interface
 *   2. Register it via registerBackend()
 *   3. Set the active backend via setActiveBackend()
 *
 * The SceneClipRenderer and InternalRenderPipeline call through this
 * interface for frame rendering.
 */

import type { ResolvedElement, BackgroundDef } from '../types';
import type { LoadedAssets } from '../assets/assetPipeline';

// ═══════════════════════════════════════════════════════════════════════════════
// BACKEND INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A RenderBackend can produce pixel frames from resolved element state.
 * All backends must implement this interface.
 */
export interface RenderBackend {
  /** Unique identifier for this backend. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Whether this backend is available in the current environment. */
  isAvailable(): Promise<boolean>;
  /**
   * Initialize the backend (load libraries, set up contexts, etc.).
   * Called once before rendering starts.
   */
  initialize(config: BackendConfig): Promise<void>;
  /**
   * Render a single frame from resolved elements.
   * Returns raw RGBA buffer (width * height * 4 bytes).
   */
  renderFrame(
    elements: ResolvedElement[],
    assets: LoadedAssets,
    config: FrameConfig,
    frameIndex: number,
  ): Promise<Buffer>;
  /**
   * Render a frame and encode as PNG (for previews/thumbnails).
   */
  renderFrameAsPng(
    elements: ResolvedElement[],
    assets: LoadedAssets,
    config: FrameConfig,
    frameIndex: number,
  ): Promise<Buffer>;
  /**
   * Cleanup/dispose any resources held by the backend.
   * Called after rendering completes.
   */
  dispose(): Promise<void>;
}

export interface BackendConfig {
  /** Maximum concurrent frame renders (for backends that support parallelism). */
  maxConcurrency?: number;
  /** Enable GPU acceleration if available. */
  useGpu?: boolean;
  /** Quality level hint (0–100). */
  quality?: number;
}

export interface FrameConfig {
  width: number;
  height: number;
  background: BackgroundDef;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKEND REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const backends = new Map<string, RenderBackend>();
let activeBackendId = 'sharp'; // default

/**
 * Register a render backend.
 */
export function registerBackend(backend: RenderBackend): void {
  backends.set(backend.id, backend);
}

/**
 * Set the active backend by ID.
 */
export function setActiveBackend(id: string): void {
  if (!backends.has(id)) {
    throw new Error(`Render backend "${id}" not registered. Available: ${[...backends.keys()].join(', ')}`);
  }
  activeBackendId = id;
}

/**
 * Get the currently active backend.
 */
export function getActiveBackend(): RenderBackend {
  const backend = backends.get(activeBackendId);
  if (!backend) {
    throw new Error(`Active render backend "${activeBackendId}" not found. Ensure it is registered.`);
  }
  return backend;
}

/**
 * Get a backend by ID.
 */
export function getBackend(id: string): RenderBackend | undefined {
  return backends.get(id);
}

/**
 * List all registered backends.
 */
export function listBackends(): Array<{ id: string; name: string }> {
  return [...backends.values()].map(b => ({ id: b.id, name: b.name }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARP BACKEND (default implementation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The Sharp-based backend. This is the default V1 renderer.
 * Uses Sharp (libvips) for compositing + SVG overlay for text.
 *
 * Delegates to the existing frameRenderer module, wrapping it in
 * the RenderBackend interface.
 */
class SharpBackend implements RenderBackend {
  readonly id = 'sharp';
  readonly name = 'Sharp (libvips)';

  async isAvailable(): Promise<boolean> {
    try {
      const sharp = await import('sharp');
      return !!sharp;
    } catch {
      return false;
    }
  }

  async initialize(_config: BackendConfig): Promise<void> {
    // Sharp doesn't need explicit initialization
  }

  async renderFrame(
    elements: ResolvedElement[],
    assets: LoadedAssets,
    config: FrameConfig,
    frameIndex: number,
  ): Promise<Buffer> {
    // Delegate to existing frameRenderer
    const { renderFrame } = await import('../core/frameRenderer');
    return renderFrame(elements, assets, config, frameIndex);
  }

  async renderFrameAsPng(
    elements: ResolvedElement[],
    assets: LoadedAssets,
    config: FrameConfig,
    frameIndex: number,
  ): Promise<Buffer> {
    const { renderFrameAsPng } = await import('../core/frameRenderer');
    return renderFrameAsPng(elements, assets, config, frameIndex);
  }

  async dispose(): Promise<void> {
    // No cleanup needed for Sharp
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANVAS BACKEND STUB (future implementation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Placeholder for a future Canvas (node-canvas / Skia) backend.
 * When implemented, this would use CanvasRenderingContext2D for
 * higher-quality text rendering and more complex visual effects.
 */
class CanvasBackendStub implements RenderBackend {
  readonly id = 'canvas';
  readonly name = 'Canvas (Skia) — not yet implemented';

  async isAvailable(): Promise<boolean> {
    try {
      // Check if node-canvas is installed
      await import('canvas');
      return true;
    } catch {
      return false;
    }
  }

  async initialize(_config: BackendConfig): Promise<void> {
    throw new Error('Canvas backend not yet implemented. Use Sharp backend.');
  }

  async renderFrame(): Promise<Buffer> {
    throw new Error('Canvas backend not yet implemented');
  }

  async renderFrameAsPng(): Promise<Buffer> {
    throw new Error('Canvas backend not yet implemented');
  }

  async dispose(): Promise<void> {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-REGISTER DEFAULT BACKENDS
// ═══════════════════════════════════════════════════════════════════════════════

registerBackend(new SharpBackend());
registerBackend(new CanvasBackendStub());

// Ensure Sharp is available by default; if not, log a warning
(async () => {
  const sharp = backends.get('sharp')!;
  const available = await sharp.isAvailable();
  if (!available) {
    console.warn('[RenderBackend] Sharp is not available — frame rendering will fail. Install: npm install sharp');
  }
})();
