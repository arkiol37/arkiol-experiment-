export interface PerformanceMetrics { renderJobId: string; totalDurationMs: number; stageTimings: Record<string, number>; providerLatencyMs: number; cacheHitRate: number; }
export interface OptimizationRecommendation { type: string; description: string; expectedImprovement: number; params: Record<string, unknown>; }
const store: PerformanceMetrics[] = [];
export function recordMetrics(m: PerformanceMetrics): void { store.push(m); if (store.length > 1000) store.shift(); }
export function analyzePerformance(recentCount = 20): OptimizationRecommendation[] {
  const recent = store.slice(-recentCount);
  if (recent.length < 5) return [];
  const recs: OptimizationRecommendation[] = [];
  const avgCache = recent.reduce((s, m) => s + m.cacheHitRate, 0) / recent.length;
  if (avgCache < 0.3) recs.push({ type: 'cache_strategy', description: 'Low cache hit rate — pre-warm templates', expectedImprovement: 20, params: { targetHitRate: 0.5 } });
  const avgLatency = recent.reduce((s, m) => s + m.providerLatencyMs, 0) / recent.length;
  if (avgLatency > 30000) recs.push({ type: 'provider_selection', description: 'High provider latency — consider failover', expectedImprovement: 25, params: { currentAvgMs: avgLatency } });
  return recs;
}
