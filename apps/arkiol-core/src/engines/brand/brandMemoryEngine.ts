/**
 * Brand Memory Engine — learns from past generations to improve future
 * brand-consistent outputs. Tracks which visual choices received positive
 * feedback and reinforces them.
 */
export interface BrandMemoryEntry {
  brandId: string;
  workspaceId: string;
  learnedAt: Date;
  attribute: string;
  value: unknown;
  confidence: number;
  sourceJobIds: string[];
}

const memory = new Map<string, BrandMemoryEntry[]>();

export function learnFromGeneration(brandId: string, workspaceId: string, jobId: string, attributes: Record<string, unknown>, feedback: number): void {
  const entries = memory.get(brandId) || [];
  for (const [attr, value] of Object.entries(attributes)) {
    const existing = entries.find(e => e.attribute === attr && JSON.stringify(e.value) === JSON.stringify(value));
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + (feedback > 3 ? 0.1 : -0.05));
      if (!existing.sourceJobIds.includes(jobId)) existing.sourceJobIds.push(jobId);
      existing.learnedAt = new Date();
    } else {
      entries.push({ brandId, workspaceId, learnedAt: new Date(), attribute: attr, value, confidence: feedback > 3 ? 0.6 : 0.3, sourceJobIds: [jobId] });
    }
  }
  memory.set(brandId, entries);
}

export function getBrandPreferences(brandId: string, minConfidence = 0.5): Record<string, unknown> {
  const entries = memory.get(brandId) || [];
  const prefs: Record<string, unknown> = {};
  for (const entry of entries.filter(e => e.confidence >= minConfidence)) {
    if (!prefs[entry.attribute] || (prefs[entry.attribute] as any).__confidence < entry.confidence) {
      prefs[entry.attribute] = entry.value;
    }
  }
  return prefs;
}

export function getBrandMemoryStrength(brandId: string): { totalEntries: number; avgConfidence: number; strongPreferences: number } {
  const entries = memory.get(brandId) || [];
  if (entries.length === 0) return { totalEntries: 0, avgConfidence: 0, strongPreferences: 0 };
  return {
    totalEntries: entries.length,
    avgConfidence: entries.reduce((s, e) => s + e.confidence, 0) / entries.length,
    strongPreferences: entries.filter(e => e.confidence >= 0.7).length,
  };
}
