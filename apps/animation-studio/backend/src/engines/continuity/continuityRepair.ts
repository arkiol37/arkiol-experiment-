import type { StoryboardScene, ContinuityViolation, CameraPreset } from "../types";

const CA: Record<CameraPreset, CameraPreset[]> = { push_in: ["ken_burns","rise_up"], pull_back: ["horizontal_drift","static_lock"], horizontal_drift: ["push_in","dolly_left"], ken_burns: ["push_in","rise_up"], static_lock: ["push_in","horizontal_drift"], rise_up: ["pull_back","crane_down"], orbit: ["ken_burns","rise_up"], crane_down: ["rise_up","pull_back"], dolly_left: ["dolly_right","horizontal_drift"], dolly_right: ["dolly_left","horizontal_drift"] };

export function repairContinuity(scenes: StoryboardScene[], violations: ContinuityViolation[]): StoryboardScene[] {
  const r = scenes.map(s => ({ ...s, continuityTokens: [...s.continuityTokens] }));
  const sm = new Map(r.map(s => [s.id, s]));
  for (const v of violations) {
    if (!v.autoFixable) continue; const s = sm.get(v.sceneId); if (!s) continue;
    if (["color","font","brand"].includes(v.token.category)) {
      const idx = s.continuityTokens.findIndex(t => t.key === v.token.key && t.category === v.token.category);
      if (idx >= 0) s.continuityTokens[idx] = { ...s.continuityTokens[idx], value: v.expected };
      else s.continuityTokens.push({ key: v.token.key, value: v.expected, scope: "global", category: v.token.category });
    }
    if (v.token.category === "motion") {
      const alts = CA[s.cameraMove] || ["static_lock"];
      const prev = r.find(sc => sc.position === s.position - 1);
      for (const a of alts) { if (a !== prev?.cameraMove) { s.cameraMove = a; break; } }
    }
  }
  return r.sort((a, b) => a.position - b.position);
}
