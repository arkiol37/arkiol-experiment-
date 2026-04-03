import type { StoryboardScene, TimelineTrack, DirectorIntent, TransitionType } from "../types";

export interface TransitionSpec { fromSceneId: string; toSceneId: string; type: TransitionType; durationMs: number; ffmpegFilter: string; emotionalContrast: number; }

const DURS: Record<TransitionType, number> = { cut: 0, crossfade: 500, push: 400, zoom: 600, wipe: 500, morph: 800, dissolve: 700, slide: 400 };
const FF: Record<TransitionType, (d: number) => string> = {
  cut: () => "", crossfade: (d) => `xfade=transition=fade:duration=${d/1000}:offset=OFFSET`,
  push: (d) => `xfade=transition=slideleft:duration=${d/1000}:offset=OFFSET`,
  zoom: (d) => `xfade=transition=zoomin:duration=${d/1000}:offset=OFFSET`,
  wipe: (d) => `xfade=transition=wipeleft:duration=${d/1000}:offset=OFFSET`,
  morph: (d) => `xfade=transition=smoothleft:duration=${d/1000}:offset=OFFSET`,
  dissolve: (d) => `xfade=transition=dissolve:duration=${d/1000}:offset=OFFSET`,
  slide: (d) => `xfade=transition=slideright:duration=${d/1000}:offset=OFFSET`,
};

export function computeTransitions(scenes: StoryboardScene[], _timeline: TimelineTrack[], intent: DirectorIntent): TransitionSpec[] {
  const specs: TransitionSpec[] = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const c = scenes[i], nx = scenes[i+1];
    const contrast = Math.min(1, Math.abs(c.emotionTarget - nx.emotionTarget) + (c.role !== nx.role ? 0.3 : 0));
    let type: TransitionType = contrast > 0.7 ? "zoom" : contrast > 0.5 ? "push" : c.role === "problem" && nx.role === "solution" ? "zoom" : intent.mood === "Cinematic" ? "dissolve" : "crossfade";
    const dur = DURS[type] || 500;
    specs.push({ fromSceneId: c.id, toSceneId: nx.id, type, durationMs: dur, ffmpegFilter: FF[type]?.(dur) || "", emotionalContrast: contrast });
  }
  return specs;
}
