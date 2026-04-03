import type { StoryboardScene, ContinuityViolation } from "../types";

export function validateContinuity(scenes: StoryboardScene[]): ContinuityViolation[] {
  const v: ContinuityViolation[] = [];
  const globals = new Map<string, { value: unknown; src: string }>();
  for (const s of scenes) {
    for (const t of s.continuityTokens) {
      if (t.scope === "global") {
        const k = `${t.category}:${t.key}`; const ex = globals.get(k);
        if (ex && JSON.stringify(ex.value) !== JSON.stringify(t.value)) v.push({ sceneId: s.id, token: t, expected: ex.value, actual: t.value, severity: t.category === "brand" ? "critical" : "error", autoFixable: true, suggestedFix: `Set to ${JSON.stringify(ex.value)}` });
        else if (!ex) globals.set(k, { value: t.value, src: s.id });
      }
    }
  }
  for (const s of scenes) for (const req of ["brand_name","mood","aspect_ratio"]) if (!s.continuityTokens.some(t => t.key === req)) v.push({ sceneId: s.id, token: { key: req, value: null, scope: "global", category: "brand" }, expected: "defined", actual: "missing", severity: "warning", autoFixable: true });
  for (let i = 0; i < scenes.length - 1; i++) if (scenes[i].cameraMove === scenes[i+1].cameraMove && scenes[i].cameraMove !== "static_lock") v.push({ sceneId: scenes[i+1].id, token: { key: "camera", value: scenes[i+1].cameraMove, scope: "scene", category: "motion" }, expected: "different", actual: scenes[i+1].cameraMove, severity: "warning", autoFixable: true });
  return v;
}
