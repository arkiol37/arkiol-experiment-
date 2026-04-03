export interface MusicTrackEntry { id: string; title: string; mood: string; energy: number; bpm: number; genre: string; durationSec: number; url: string; tags: string[]; }
export const MUSIC_CATALOG: MusicTrackEntry[] = [
  { id: 'lux_01', title: 'Golden Hour', mood: 'Luxury', energy: 0.4, bpm: 82, genre: 'ambient_jazz', durationSec: 120, url: '/audio/golden_hour.mp3', tags: ['premium','elegant'] },
  { id: 'ene_01', title: 'Pulse Drive', mood: 'Energetic', energy: 0.85, bpm: 128, genre: 'electronic', durationSec: 90, url: '/audio/pulse_drive.mp3', tags: ['dynamic','upbeat'] },
  { id: 'min_01', title: 'Clean Slate', mood: 'Minimal', energy: 0.3, bpm: 95, genre: 'ambient', durationSec: 180, url: '/audio/clean_slate.mp3', tags: ['clean','modern'] },
  { id: 'pla_01', title: 'Bounce Joy', mood: 'Playful', energy: 0.7, bpm: 120, genre: 'indie_pop', durationSec: 90, url: '/audio/bounce_joy.mp3', tags: ['fun','bright'] },
  { id: 'cin_01', title: 'Epic Dawn', mood: 'Cinematic', energy: 0.65, bpm: 100, genre: 'orchestral', durationSec: 150, url: '/audio/epic_dawn.mp3', tags: ['dramatic','epic'] },
  { id: 'emo_01', title: 'Heartstrings', mood: 'Emotional', energy: 0.5, bpm: 76, genre: 'piano', durationSec: 120, url: '/audio/heartstrings.mp3', tags: ['touching','warm'] },
  { id: 'cor_01', title: 'Forward Motion', mood: 'Corporate', energy: 0.55, bpm: 110, genre: 'corporate', durationSec: 120, url: '/audio/forward_motion.mp3', tags: ['professional'] },
  { id: 'bol_01', title: 'Raw Power', mood: 'Bold', energy: 0.8, bpm: 130, genre: 'hip_hop', durationSec: 90, url: '/audio/raw_power.mp3', tags: ['impact','strong'] },
  { id: 'cal_01', title: 'Still Waters', mood: 'Calm', energy: 0.2, bpm: 68, genre: 'ambient', durationSec: 180, url: '/audio/still_waters.mp3', tags: ['peaceful'] },
  { id: 'tec_01', title: 'Neon Grid', mood: 'Tech', energy: 0.7, bpm: 125, genre: 'synthwave', durationSec: 120, url: '/audio/neon_grid.mp3', tags: ['futuristic'] },
];
export function selectTrack(mood: string, energy?: number): MusicTrackEntry { const m = MUSIC_CATALOG.filter(t => t.mood.toLowerCase() === mood.toLowerCase()); if (m.length > 0) { if (energy !== undefined) m.sort((a, b) => Math.abs(a.energy - energy) - Math.abs(b.energy - energy)); return m[0]; } return MUSIC_CATALOG[0]; }
