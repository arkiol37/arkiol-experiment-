import { logger } from '../../config/logger';
export interface FeedbackEntry { renderJobId: string; workspaceId: string; rating: number; aspects: Record<string, number>; textFeedback?: string; timestamp: Date; }
export interface FeedbackInsight { category: string; trend: 'improving' | 'declining' | 'stable'; avgScore: number; sampleSize: number; recommendation: string; }
const store: FeedbackEntry[] = [];
export function recordFeedback(entry: FeedbackEntry): void { store.push(entry); logger.info(`[Feedback] Rating ${entry.rating}/5 for ${entry.renderJobId}`); }
export function analyzeFeedback(workspaceId: string, limit = 50): FeedbackInsight[] {
  const entries = store.filter(f => f.workspaceId === workspaceId).slice(-limit);
  if (entries.length < 3) return [];
  const insights: FeedbackInsight[] = [];
  for (const cat of ['visual','audio','pacing','brand','overall']) {
    const scores = entries.map(e => e.aspects[cat]).filter(s => s !== undefined);
    if (scores.length < 2) continue;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const half = Math.ceil(scores.length / 2);
    const recent = scores.slice(-half).reduce((s, v) => s + v, 0) / half;
    const older = scores.slice(0, half).reduce((s, v) => s + v, 0) / half;
    const trend = recent > older + 0.3 ? 'improving' as const : recent < older - 0.3 ? 'declining' as const : 'stable' as const;
    insights.push({ category: cat, trend, avgScore: avg, sampleSize: scores.length, recommendation: avg < 3 ? `${cat} below average` : `${cat} good` });
  }
  return insights;
}
