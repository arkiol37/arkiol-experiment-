/**
 * Timeline Schema — validates multi-track timeline structure.
 */
import { z } from 'zod';

export const TimelineTrackTypeSchema = z.enum(['scene', 'transition', 'audio', 'overlay', 'subtitle']);

export const TimelineTrackSchema = z.object({
  id: z.string(),
  type: TimelineTrackTypeSchema,
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  layerIndex: z.number().int().min(0).max(10),
  data: z.record(z.unknown()),
}).refine(d => d.endMs > d.startMs, { message: 'endMs must be > startMs' });

export const TimelineSchema = z.object({
  tracks: z.array(TimelineTrackSchema).min(1),
  totalDurationMs: z.number().int().min(1000),
  fps: z.number().int().min(24).max(60).default(30),
});

export type Timeline = z.infer<typeof TimelineSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;
