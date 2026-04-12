/**
 * Render Funnel — tracks user conversion through the creative workflow.
 */
export type FunnelStep = 'brief_entered' | 'storyboard_generated' | 'render_queued' | 'render_complete' | 'downloaded' | 'shared';

const funnelData = new Map<string, { step: FunnelStep; timestamp: Date }[]>();

export function trackFunnelStep(sessionId: string, step: FunnelStep): void {
  const entries = funnelData.get(sessionId) || [];
  entries.push({ step, timestamp: new Date() });
  funnelData.set(sessionId, entries);
}

export function getFunnelConversion(): Record<FunnelStep, { count: number; dropOffRate: number }> {
  const steps: FunnelStep[] = ['brief_entered', 'storyboard_generated', 'render_queued', 'render_complete', 'downloaded', 'shared'];
  const counts: Record<string, number> = {};
  steps.forEach(s => counts[s] = 0);
  for (const entries of funnelData.values()) {
    for (const e of entries) if (counts[e.step] !== undefined) counts[e.step]++;
  }
  const result: Record<string, { count: number; dropOffRate: number }> = {};
  steps.forEach((step, i) => {
    result[step] = {
      count: counts[step],
      dropOffRate: i > 0 && counts[steps[i - 1]] > 0 ? 1 - counts[step] / counts[steps[i - 1]] : 0,
    };
  });
  return result as Record<FunnelStep, { count: number; dropOffRate: number }>;
}
