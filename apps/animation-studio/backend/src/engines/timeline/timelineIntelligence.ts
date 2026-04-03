import { v4 as uuidv4 } from "uuid";
import type { StoryboardScene, DirectorIntent, TimelineTrack } from "../types";

export function buildTimelineIntelligence(scenes: StoryboardScene[], intent: DirectorIntent): TimelineTrack[] {
  const tracks: TimelineTrack[] = []; let curMs = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]; const durMs = s.durationSec * 1000;
    tracks.push({ id: uuidv4(), type: "scene", startMs: curMs, endMs: curMs + durMs, layerIndex: 0, data: { sceneId: s.id, role: s.role, position: s.position, durationMs: durMs } });
    if (i < scenes.length - 1 && s.transitionOut !== "cut") tracks.push({ id: uuidv4(), type: "transition", startMs: curMs + durMs - 500, endMs: curMs + durMs + 500, layerIndex: 1, data: { fromSceneId: s.id, toSceneId: scenes[i+1].id, type: s.transitionOut, durationMs: 1000 } });
    if (s.onScreenText) tracks.push({ id: uuidv4(), type: "overlay", startMs: curMs + 400, endMs: curMs + Math.min(durMs - 500, 3400), layerIndex: 3, data: { sceneId: s.id, text: s.onScreenText } });
    if (s.voiceoverScript) tracks.push({ id: uuidv4(), type: "audio", startMs: curMs + 300, endMs: curMs + durMs - 200, layerIndex: 2, data: { sceneId: s.id, type: "voiceover", script: s.voiceoverScript } });
    curMs += durMs;
  }
  tracks.push({ id: uuidv4(), type: "audio", startMs: 0, endMs: curMs, layerIndex: 4, data: { type: "music", mood: intent.mood } });
  return tracks;
}
export function getTimelineDuration(tracks: TimelineTrack[]): number { return Math.max(0, ...tracks.map(t => t.endMs)); }
