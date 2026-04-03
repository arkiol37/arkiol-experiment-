export interface AdPerformanceData { renderJobId: string; platform: string; impressions: number; clicks: number; ctr: number; videoViews: number; completionRate: number; conversions: number; }
const store: AdPerformanceData[] = [];
export function recordPerformance(data: AdPerformanceData): void { store.push(data); }
export function getPerformanceSummary(): { totalImpressions: number; avgCtr: number; avgCompletionRate: number } { if (store.length === 0) return { totalImpressions: 0, avgCtr: 0, avgCompletionRate: 0 }; return { totalImpressions: store.reduce((s, d) => s + d.impressions, 0), avgCtr: store.reduce((s, d) => s + d.ctr, 0) / store.length, avgCompletionRate: store.reduce((s, d) => s + d.completionRate, 0) / store.length }; }
