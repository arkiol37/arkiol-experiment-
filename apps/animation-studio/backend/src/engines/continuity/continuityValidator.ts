import type { StoryboardScene, ContinuityViolation } from "../types";

export interface ValidationResult { passed: boolean; score: number; violations: ContinuityViolation[]; suggestions: string[]; }

export function deepValidate(scenes: StoryboardScene[]): ValidationResult {
  const v: ContinuityViolation[] = []; const sugg: string[] = []; let score = 100;
  const first = scenes[0];
  if (first && !first.continuityTokens.some(t => t.key === "brand_name")) { v.push({ sceneId: first.id, token: { key: "brand_name", value: null, scope: "global", category: "brand" }, expected: "present", actual: "missing", severity: "error", autoFixable: true }); score -= 10; }
  for (let i = 0; i < scenes.length - 1; i++) if (Math.abs(scenes[i].emotionTarget - scenes[i+1].emotionTarget) > 0.5) { sugg.push(`Large emotion jump between scenes ${i} and ${i+1}.`); score -= 5; }
  if (!scenes.some(s => s.role === "cta")) { v.push({ sceneId: scenes[scenes.length-1]?.id || "", token: { key: "role", value: "cta", scope: "global", category: "layout" }, expected: "present", actual: "missing", severity: "critical", autoFixable: false }); score -= 15; }
  if (first && first.role !== "hook") { v.push({ sceneId: first.id, token: { key: "role", value: first.role, scope: "scene", category: "layout" }, expected: "hook", actual: first.role, severity: "error", autoFixable: true }); score -= 10; }
  return { passed: score >= 70 && !v.some(vi => vi.severity === "critical"), score: Math.max(0, score), violations: v, suggestions: sugg };
}
