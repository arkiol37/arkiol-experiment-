import { LayoutCandidate } from "./layout-intelligence";

const memory: Record<string, number> = {};

export function recordUserPreference(candidate: LayoutCandidate) {
  memory[candidate.pattern.id] = (memory[candidate.pattern.id] || 0) + 1;
}

export function adjustScoreWithFeedback(candidate: LayoutCandidate): number {
  const boost = memory[candidate.pattern.id] || 0;
  return candidate.score.total + boost * 0.02;
}
