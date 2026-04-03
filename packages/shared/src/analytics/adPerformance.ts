/**
 * Ad Performance — cross-platform ad creative performance tracking.
 */
export interface AdCreativePerformance {
  renderJobId: string;
  workspaceId: string;
  platform: string;
  placement: string;
  impressions: number;
  clicks: number;
  videoViews: number;
  avgWatchTimeSec: number;
  completionRate: number;
  conversions: number;
  spend: number;
  measuredAt: Date;
}

const store: AdCreativePerformance[] = [];

export function ingestPerformanceData(data: AdCreativePerformance): void {
  store.push(data);
}

export function getTopCreatives(workspaceId: string, metric: 'ctr' | 'completionRate' | 'conversions' = 'ctr', limit = 10): AdCreativePerformance[] {
  const filtered = store.filter(d => d.workspaceId === workspaceId);
  const sorted = filtered.sort((a, b) => {
    if (metric === 'ctr') return (b.clicks / Math.max(1, b.impressions)) - (a.clicks / Math.max(1, a.impressions));
    if (metric === 'completionRate') return b.completionRate - a.completionRate;
    return b.conversions - a.conversions;
  });
  return sorted.slice(0, limit);
}

export function getPerformanceBenchmarks(workspaceId: string): { avgCtr: number; avgCompletionRate: number; avgCostPerConversion: number } {
  const filtered = store.filter(d => d.workspaceId === workspaceId);
  if (filtered.length === 0) return { avgCtr: 0, avgCompletionRate: 0, avgCostPerConversion: 0 };
  const avgCtr = filtered.reduce((s, d) => s + d.clicks / Math.max(1, d.impressions), 0) / filtered.length;
  const avgCR = filtered.reduce((s, d) => s + d.completionRate, 0) / filtered.length;
  const avgCPC = filtered.reduce((s, d) => s + (d.conversions > 0 ? d.spend / d.conversions : 0), 0) / filtered.length;
  return { avgCtr: avgCtr, avgCompletionRate: avgCR, avgCostPerConversion: avgCPC };
}
