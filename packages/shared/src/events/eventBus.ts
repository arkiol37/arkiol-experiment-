/**
 * Event Bus — typed, cross-module event system for pipeline coordination.
 */
import { EventEmitter } from 'events';

export type ArkiolEvent =
  | 'project.created' | 'project.updated' | 'project.deleted'
  | 'render.queued' | 'render.started' | 'render.scene_complete' | 'render.complete' | 'render.failed'
  | 'brand.asset_uploaded' | 'brand.asset_deleted' | 'brand.palette_updated'
  | 'billing.credits_deducted' | 'billing.credits_refunded' | 'billing.plan_changed'
  | 'engine.stage_complete' | 'engine.stage_failed' | 'engine.pipeline_complete';

export interface ArkiolEventPayload {
  event: ArkiolEvent;
  timestamp: Date;
  workspaceId: string;
  userId?: string;
  resourceId?: string;
  data: Record<string, unknown>;
}

class ArkiolEventBus extends EventEmitter {
  emit(event: ArkiolEvent, payload: Omit<ArkiolEventPayload, 'event' | 'timestamp'>): boolean {
    return super.emit(event, { ...payload, event, timestamp: new Date() });
  }

  on(event: ArkiolEvent, handler: (payload: ArkiolEventPayload) => void): this {
    return super.on(event, handler);
  }

  once(event: ArkiolEvent, handler: (payload: ArkiolEventPayload) => void): this {
    return super.once(event, handler);
  }
}

export const eventBus = new ArkiolEventBus();
eventBus.setMaxListeners(100);

export function emitEvent(event: ArkiolEvent, workspaceId: string, data: Record<string, unknown>, userId?: string, resourceId?: string): void {
  eventBus.emit(event, { workspaceId, userId, resourceId, data });
}
