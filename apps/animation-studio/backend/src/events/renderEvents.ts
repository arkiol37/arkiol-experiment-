import { EventEmitter } from 'events';
export type RenderEvent = 'render.queued' | 'render.started' | 'render.scene_complete' | 'render.mixing' | 'render.complete' | 'render.failed' | 'render.cancelled';
export interface RenderEventPayload { renderJobId: string; workspaceId: string; event: RenderEvent; timestamp: Date; data?: Record<string, unknown>; }
class RenderEventBus extends EventEmitter {
  emitRender(event: RenderEvent, payload: Omit<RenderEventPayload, 'event' | 'timestamp'>): boolean { return super.emit(event, { ...payload, event, timestamp: new Date() }); }
  onRenderEvent(event: RenderEvent, handler: (payload: RenderEventPayload) => void): this { return this.on(event, handler); }
}
export const renderEventBus = new RenderEventBus();
renderEventBus.setMaxListeners(50);
