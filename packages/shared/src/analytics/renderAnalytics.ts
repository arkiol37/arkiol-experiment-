/**
 * Render Analytics — cross-app render pipeline telemetry.
 */
export interface RenderAnalyticsEvent {
  eventType: 'render_queued' | 'render_started' | 'scene_complete' | 'render_complete' | 'render_failed';
  renderJobId: string;
  workspaceId: string;
  timestamp: Date;
  properties: Record<string, unknown>;
}

const events: RenderAnalyticsEvent[] = [];
const MAX_EVENTS = 5000;

export function trackRenderEvent(event: RenderAnalyticsEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function getRenderMetrics(workspaceId?: string, since?: Date): {
  totalRenders: number; completedRenders: number; failedRenders: number;
  avgDurationMs: number; successRate: number;
} {
  const filtered = events.filter(e => {
    if (workspaceId && e.workspaceId !== workspaceId) return false;
    if (since && e.timestamp < since) return false;
    return true;
  });
  const completed = filtered.filter(e => e.eventType === 'render_complete');
  const failed = filtered.filter(e => e.eventType === 'render_failed');
  const queued = filtered.filter(e => e.eventType === 'render_queued');
  const durations = completed.map(e => (e.properties.durationMs as number) || 0).filter(d => d > 0);
  return {
    totalRenders: queued.length, completedRenders: completed.length, failedRenders: failed.length,
    avgDurationMs: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
    successRate: queued.length > 0 ? completed.length / queued.length : 0,
  };
}
