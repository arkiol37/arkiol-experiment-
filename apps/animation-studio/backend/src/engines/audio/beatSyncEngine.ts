import type { MusicProfile, TimelineTrack, StoryboardScene, AudioSyncPoint } from "../types";

export function syncBeats(mp: MusicProfile, timeline: TimelineTrack[], _scenes: StoryboardScene[]): AudioSyncPoint[] {
  const sps: AudioSyncPoint[] = []; const bMs = 60000 / mp.bpm;
  const totalMs = Math.max(0, ...timeline.map(t => t.endMs));
  for (let t = 0; t < totalMs; t += bMs) {
    const isBar = Math.round(t / bMs) % 4 === 0;
    sps.push({ timeMs: Math.round(t), type: isBar ? "accent" : "beat", intensity: isBar ? 0.7 : 0.4 });
  }
  for (const tr of timeline.filter(t => t.type === "scene")) {
    const near = sps.reduce((b, sp) => Math.abs(sp.timeMs - tr.startMs) < Math.abs(b.timeMs - tr.startMs) ? sp : b, sps[0]);
    if (near && Math.abs(near.timeMs - tr.startMs) < 200) { near.type = "transition"; near.intensity = Math.min(1, near.intensity + 0.2); near.linkedSceneEvent = `scene:${(tr.data as any).sceneId}`; }
  }
  for (const vt of timeline.filter(t => t.type === "audio" && (t.data as any).type === "voiceover")) {
    sps.push({ timeMs: vt.startMs, type: "vocal_start", intensity: 0.6, linkedSceneEvent: `vo:${(vt.data as any).sceneId}` });
    sps.push({ timeMs: vt.endMs, type: "vocal_end", intensity: 0.3 });
  }
  return sps.sort((a, b) => a.timeMs - b.timeMs);
}

export function snapToBeat(timeMs: number, bpm: number): number { const bi = 60000 / bpm; return Math.round(timeMs / bi) * bi; }
